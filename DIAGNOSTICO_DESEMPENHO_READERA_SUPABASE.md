# Diagnostico de desempenho do ReadEra Web Pro com Supabase

Data da analise: 2026-05-17

## Objetivo desta analise

Este documento registra uma investigacao tecnica sobre a demora percebida ao abrir o aplicativo, receber dados da nuvem e iniciar a leitura de PDFs no ReadEra Web Pro.

O pedido original foi:

- analisar os arquivos remotos do GitHub;
- nao alterar o comportamento do aplicativo;
- descobrir por que o carregamento passou a demorar mais;
- considerar a hipotese de limite/banda do Supabase;
- explicar de forma detalhada o que pode estar acontecendo.

Durante esta analise, nenhum arquivo de logica do app foi alterado. Este arquivo foi criado depois apenas para documentar o diagnostico.

---

## Estado do GitHub analisado

A branch analisada foi:

```txt
main
```

O commit remoto analisado era:

```txt
e9bab29 Revert "Improve mobile PDF reading layout"
```

Isso significa que a alteracao de layout mobile que tinha causado problema anteriormente ja estava revertida no remoto.

Historico recente relevante:

```txt
e9bab29 Revert "Improve mobile PDF reading layout"
87ddb35 Improve mobile PDF reading layout
b49e11f Add media session controls for TTS playback
7775e5f Add backend TTS engine fallback
f57afb4 Add files via upload
```

Conclusao sobre o estado remoto:

- a `main` remota estava sincronizada com o ambiente analisado;
- o commit problemático de layout mobile nao estava mais efetivo;
- o app ainda contem as alteracoes de backend TTS opcional e Media Session;
- o app ainda usa Supabase Storage para salvar e abrir PDFs da nuvem.

---

## Configuracao Supabase encontrada no frontend

O arquivo `config.js` contem a configuracao publica do Supabase:

```js
window.READERA_SUPABASE = window.READERA_SUPABASE || {
  url: 'https://ezcmdbcxgqvonqewgvrm.supabase.co',
  anonKey: '...'
};
```

Observacao importante:

- a `anonKey` e uma chave publica de browser;
- ela nao e `service_role`;
- ela permite que o frontend acesse tabelas e Storage conforme as politicas RLS configuradas no Supabase;
- ela nao permite fazer operacoes administrativas como publicar Edge Functions ou alterar segredos.

Tambem existe configuracao opcional de TTS backend:

```js
window.READERA_TTS = window.READERA_TTS || {
  mode: 'auto',
  endpoint: 'https://ezcmdbcxgqvonqewgvrm.supabase.co/functions/v1/readera-tts',
  voice: 'alloy',
  format: 'mp3',
  maxChars: 3800
};
```

Essa configuracao aponta para uma Edge Function chamada:

```txt
readera-tts
```

Porem, no momento da analise, essa funcao ainda nao estava publicada no Supabase.

Resultado medido:

```txt
tts endpoint probe: status=404
body={"code":"NOT_FOUND","message":"Requested function was not found"}
```

Impacto:

- isso nao deve ser a causa principal da demora para abrir o PDF;
- mas pode gerar atraso ao iniciar a leitura caso o motor esteja em `Auto`;
- nesse caso o app tenta Backend, recebe erro 404 rapidamente e cai para Navegador;
- a chamada respondeu rapido na medicao, cerca de 0.052s, entao nao parece ser o gargalo principal.

---

## Fluxo atual de inicializacao do app

No final do `index.html`, o app chama:

```js
initSupabaseClient();
```

Dentro de `initSupabaseClient()`, quando a configuracao Supabase existe, o fluxo principal e:

```js
readeraSb = sb.createClient(cfg.url, cfg.anonKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    }
});

await refreshCloudLibrary();
updateCloudChrome();
...
await tryResumeLastCloudDocument();
```

Esse fluxo faz duas coisas relevantes para desempenho:

1. Lista a biblioteca de PDFs na nuvem.
2. Se configurado, tenta reabrir automaticamente o ultimo PDF salvo.

---

## Fluxo de listagem da biblioteca na nuvem

A funcao responsavel e:

```js
async function refreshCloudLibrary() {
    const sel = document.getElementById('cloud-library');
    if (!readeraSb || !sel) return;
    const { data, error } = await readeraSb.from('documents')
        .select('id, title, last_page, updated_at')
        .order('updated_at', { ascending: false })
        .limit(50);
    ...
}
```

Pontos importantes:

- essa consulta pega no maximo 50 registros;
- no momento da analise existiam apenas 6 documentos;
- portanto, a quantidade de linhas no banco nao parece ser o principal problema;
- a query retorna metadados pequenos: id, titulo, ultima pagina e data de atualizacao.

Medicao feita:

```txt
documents list limit 50:
status=200
bytes=1519
time=1.008s
```

Interpretacao:

- a listagem levou aproximadamente 1 segundo;
- nao e instantanea, mas tambem nao explica sozinha uma demora grande;
- o payload foi pequeno, apenas 1519 bytes;
- logo, a lentidao nao parece estar vindo de excesso de registros na tabela `documents`.

---

## Quantidade de documentos encontrados

Foi feita uma consulta de contagem na tabela `documents`.

Resultado:

```txt
documents total count header: 0-0/6
```

Ou seja:

```txt
Total de documentos na nuvem: 6
```

Conclusao:

- nao ha centenas ou milhares de registros;
- a tabela nao parece estar inchada;
- a demora nao vem de uma biblioteca muito grande em numero de itens.

---

## Tamanhos dos PDFs salvos na nuvem

Os documentos encontrados tinham os seguintes tamanhos aproximados:

```txt
1. 24.03 MB | 208 paginas | last_page=55
2.  6.10 MB | 277 paginas | last_page=13
3.  8.88 MB | 265 paginas | last_page=14
4.  1.87 MB | 266 paginas | last_page=16
5.  8.88 MB | 265 paginas | last_page=14
6.  8.88 MB | 265 paginas | last_page=1
```

Observacoes:

- o PDF mais recente tem aproximadamente 24 MB;
- esse PDF tem 208 paginas;
- ele estava marcado como ultimo documento atualizado;
- portanto, se a opcao de retomar ultimo PDF estiver ligada, e esse arquivo que tende a ser aberto automaticamente;
- existem pelo menos tres documentos com tamanho identico de 8.88 MB, o que sugere possiveis uploads duplicados do mesmo arquivo.

---

## Fluxo atual para abrir PDF da nuvem

A funcao responsavel por abrir um PDF salvo no Storage e:

```js
async function openCloudDocumentFromRow(row, resetSelectValue) {
    const { data: blob, error: derr } = await readeraSb.storage.from('pdfs').download(row.storage_path);
    if (derr || !blob) throw derr || new Error('Download falhou');
    const buf = await blob.arrayBuffer();
    lastOpenedFileName = row.title || 'documento.pdf';
    await loadPdfFromArrayBuffer(buf, { documentId: row.id, initialPage: row.last_page || 1 });
    ...
}
```

Esse trecho e muito importante.

Ele faz:

1. baixa o arquivo inteiro do Supabase Storage;
2. converte o arquivo inteiro para `ArrayBuffer`;
3. passa o arquivo inteiro para o PDF.js;
4. so depois renderiza a pagina.

Na pratica:

```txt
Supabase Storage -> Blob completo -> ArrayBuffer completo -> PDF.js -> primeira pagina renderizada
```

O app nao esta usando carregamento parcial por range request.

Isso significa que, para um PDF de 24 MB, o dispositivo precisa baixar os 24 MB antes de iniciar a leitura de forma completa.

Em internet rapida, isso pode parecer aceitavel.

Em celular, TV, Wi-Fi instavel ou plano com banda reduzida, isso pode ficar perceptivelmente lento.

---

## Medicao do arquivo mais recente no Storage

Foi feita uma requisicao `HEAD` ao arquivo mais recente no Storage.

Resultado:

```txt
storage HEAD latest:
status=200
content-length=25192616
time=1.030s
```

Tamanho exato:

```txt
25,192,616 bytes
```

Convertendo:

```txt
aproximadamente 24.03 MB
```

Importante:

- `HEAD` nao baixa o arquivo inteiro;
- ele so pergunta metadados, como tamanho;
- portanto, o tempo real para abrir no celular/TV pode ser muito maior;
- o download completo dependera da velocidade real da rede do usuario.

Exemplos aproximados:

| Velocidade real | Tempo minimo para 24 MB |
|---|---:|
| 1 Mbps | cerca de 3 minutos ou mais |
| 2 Mbps | cerca de 1 minuto e meio |
| 5 Mbps | cerca de 40 segundos |
| 10 Mbps | cerca de 20 segundos |
| 30 Mbps | cerca de 7 segundos |

Na pratica pode demorar mais por:

- latencia;
- perda de pacotes;
- oscilacao de Wi-Fi;
- TV com hardware fraco;
- memoria limitada;
- tempo de parse/renderizacao do PDF.js apos o download.

---

## Retomada automatica do ultimo PDF

O app tem a opcao:

```txt
Ao iniciar, abrir o ultimo PDF da nuvem
```

Internamente, isso usa:

```js
async function tryResumeLastCloudDocument() {
    if (!readeraSb) return;
    if (localStorage.getItem(LS_RESUME_CLOUD) === '0') return;
    const id = localStorage.getItem(LS_LAST_CLOUD_DOC);
    if (!id) return;
    const { data: row, error } = await readeraSb.from('documents')
        .select('id, title, storage_path, last_page')
        .eq('id', id)
        .maybeSingle();
    ...
    await openCloudDocumentFromRow(row, false);
}
```

Impacto:

- se a opcao estiver ligada;
- e se houver `LS_LAST_CLOUD_DOC` salvo no navegador;
- o app vai tentar abrir automaticamente o ultimo PDF;
- se esse ultimo PDF for o de 24 MB, a abertura inicial do app pode parecer travada ou lenta.

Isso e especialmente importante porque o usuario pode abrir o app esperando uma tela pronta rapidamente, mas por tras ele esta baixando um arquivo grande.

---

## Auto upload ao abrir PDF

O app tambem tem a opcao:

```txt
Enviar PDF para a nuvem ao abrir
```

No codigo:

```js
if (!cloudDocumentId && pdfCacheBytes && readeraSb && localStorage.getItem(LS_AUTO_CLOUD) !== '0') {
    void attemptAutoCloudSync();
}
```

E depois:

```js
async function attemptAutoCloudSync() {
    if (!readeraSb || cloudDocumentId || !pdfCacheBytes || !pdfDoc) return;
    if (localStorage.getItem(LS_AUTO_CLOUD) === '0') return;
    if (cloudSyncInFlight) return;
    ...
    await uploadPdfToCloudInternal(true);
}
```

Impacto:

- ao abrir um PDF local, o app pode automaticamente enviar esse arquivo para o Supabase;
- se o mesmo PDF for aberto varias vezes como arquivo local, podem surgir duplicatas;
- isso explica a existencia de varios documentos com tamanho identico de 8.88 MB;
- uploads grandes tambem consomem banda;
- se o usuario estudou bastante e abriu varios PDFs, pode ter consumido banda de upload/download do projeto.

Observacao:

- no fluxo de abrir um PDF ja vindo da nuvem, `cloudDocumentId` e preenchido;
- nesse caso, o app nao deve reenviar o mesmo arquivo automaticamente;
- o risco de duplicidade e maior quando o mesmo PDF e aberto localmente de novo, nao quando e retomado da nuvem.

---

## Hipotese sobre banda/limites do Supabase

A suspeita do usuario foi:

```txt
talvez seja a quantidade de banda que o Supabase pode fornecer
```

Essa hipotese e plausivel, mas com uma nuance:

- nao parece ser limite por quantidade de registros;
- parece mais relacionado a transferencia de arquivos PDF grandes pelo Storage;
- se o plano/projeto tiver cota de bandwidth e o usuario usou muito para estudar, a experiencia pode degradar ou ficar mais sensivel a rede;
- mesmo sem atingir limite formal, baixar PDFs de 24 MB repetidamente em celular/TV ja cria demora perceptivel.

Do lado do app, o comportamento atual amplifica o uso de banda porque:

1. baixa o PDF inteiro para abrir;
2. pode retomar automaticamente o ultimo PDF;
3. pode enviar PDF automaticamente ao abrir localmente;
4. pode criar duplicatas;
5. nao usa cache persistente local robusto para evitar novo download.

---

## CDNs externos

O app carrega bibliotecas externas:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.min.js"></script>
```

E tambem define o worker:

```js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
```

Foram medidas requisicoes `HEAD` para esses arquivos.

Resultados:

```txt
pdf.min.js         ~0.030s
pdf.worker.min.js  ~0.033s
supabase.min.js    ~0.030s
```

Conclusao:

- no ambiente de teste, os CDNs responderam rapido;
- nao parecem ser o gargalo principal;
- mas em TV/celular com DNS lento ou conexao ruim, CDNs externos ainda podem contribuir para primeira carga.

---

## Backend TTS

O app possui um motor de voz com opcoes:

```txt
Auto
Backend
Navegador
```

No codigo:

```js
function resolveTtsEngine() {
    const mode = getPreferredTtsMode();
    if ((mode === 'backend' || mode === 'auto') && hasBackendTts()) return 'backend';
    if ((mode === 'browser' || mode === 'auto') && canUseBrowserTts()) return 'browser';
    return null;
}
```

Como `config.js` possui um endpoint backend preenchido, `hasBackendTts()` retorna verdadeiro.

Isso significa:

- no modo `Auto`, o app tenta `Backend` primeiro;
- se a funcao nao existe, recebe 404;
- depois cai para o motor do navegador, se possivel.

Medição:

```txt
tts endpoint probe:
status=404
time=0.052s
body={"code":"NOT_FOUND","message":"Requested function was not found"}
```

Conclusao:

- a falha do backend TTS nao e a principal causa da demora para abrir o PDF;
- mas pode atrapalhar a primeira tentativa de leitura em voz;
- tambem pode confundir o usuario, porque a interface mostra `Backend`/`Auto`, mas a funcao ainda nao esta publicada.

---

## Principais causas provaveis da lentidao

### 1. PDF grande sendo baixado inteiro

Principal suspeita.

O arquivo mais recente tem:

```txt
24.03 MB
208 paginas
```

O app baixa tudo antes de renderizar.

### 2. Retomada automatica do ultimo PDF

Se ligada, o app abre automaticamente o ultimo PDF salvo.

Se o ultimo PDF e grande, a abertura inicial fica lenta.

### 3. Auto upload criando duplicatas e consumindo banda

Ha varios PDFs com tamanho identico.

Isso sugere repeticao de upload, possivelmente causada por abrir arquivos locais com auto upload ligado.

### 4. Hardware/rede de TV ou celular

Mesmo que o Supabase responda, o dispositivo precisa:

- baixar o arquivo;
- manter o Blob em memoria;
- converter para ArrayBuffer;
- passar para PDF.js;
- renderizar canvas;
- extrair texto;
- montar camada de texto;
- preparar TTS.

Em TV isso pode ser mais lento que em notebook.

### 5. Backend TTS nao publicado

Nao e o gargalo principal do PDF, mas pode atrasar ou falhar no inicio da leitura se o motor estiver em Auto/Backend.

---

## Recomendacoes sem alterar codigo

Estas medidas podem ser feitas pelo usuario na interface atual.

### 1. Desligar retomada automatica

Desligar:

```txt
Ao iniciar, abrir o ultimo PDF da nuvem
```

Motivo:

- evita que o app baixe automaticamente um PDF grande ao abrir;
- deixa o usuario escolher quando abrir o PDF;
- reduz a sensacao de travamento inicial.

### 2. Desligar auto upload

Desligar:

```txt
Enviar PDF para a nuvem ao abrir
```

Motivo:

- evita upload automatico de PDFs grandes;
- reduz consumo de banda;
- evita criar copias duplicadas;
- deixa o usuario usar manualmente o botao `Guardar` quando realmente quiser salvar.

### 3. Usar PDFs menores quando possivel

Se houver versao comprimida do PDF, preferir ela.

Exemplo:

- PDF de 1.87 MB tende a abrir muito mais rapido que PDF de 24 MB;
- em TV/celular isso faz muita diferenca.

### 4. Apagar duplicatas da nuvem com cuidado

O app possui botao:

```txt
Excluir da nuvem
```

Se houver copias repetidas, apagar duplicatas pode reduzir confusao na biblioteca.

Observacao:

- apagar nao melhora necessariamente a velocidade de um PDF especifico;
- mas ajuda a organizacao e evita abrir a copia errada.

### 5. Usar motor Navegador enquanto Backend nao estiver publicado

Selecionar:

```txt
Motor: Navegador
```

Motivo:

- evita tentativa de chamar uma Edge Function inexistente;
- reduz uma etapa desnecessaria ao iniciar a leitura.

---

## Recomendacoes futuras com alteracao de codigo

Estas nao foram aplicadas nesta analise, mas sao caminhos tecnicos para melhorar.

### 1. Nao retomar automaticamente PDF grande

Possivel comportamento:

- se o PDF tiver mais de X MB, perguntar antes de baixar;
- exemplo: "Este PDF tem 24 MB. Deseja abrir agora?"

Beneficio:

- evita carregamento automatico pesado;
- melhora percepcao de controle.

### 2. Mostrar progresso de download

Hoje o app mostra:

```txt
Carregando PDF...
```

Mas nao mostra:

- percentual baixado;
- MB baixados;
- tamanho total;
- velocidade aproximada.

Com progresso, o usuario entende que o app nao travou.

### 3. Evitar duplicatas no upload

Antes de subir um PDF, o app poderia verificar:

- nome;
- tamanho;
- numero de paginas;
- talvez hash do arquivo.

Se ja existir um documento igual, reutilizar o registro existente.

### 4. Salvar cache local

O app poderia guardar localmente o PDF ja baixado, por exemplo com:

- IndexedDB;
- Cache API;
- OPFS, se disponivel.

Assim, reabrir o mesmo PDF nao exigiria novo download do Supabase.

### 5. Usar URL assinada ou URL publica com PDF.js por streaming/range

Em vez de:

```js
download() -> blob -> arrayBuffer -> getDocument({ data })
```

Poderia usar um fluxo baseado em URL:

```js
pdfjsLib.getDocument({ url: signedUrl })
```

Se o servidor e CORS permitirem range requests, o PDF.js pode baixar partes do arquivo conforme necessidade.

Beneficio:

- primeira pagina pode aparecer antes do download completo;
- PDFs grandes ficam mais usaveis;
- menor uso inicial de memoria.

Cuidados:

- precisa validar CORS;
- precisa validar headers `Accept-Ranges`;
- precisa decidir se bucket sera publico ou signed URL;
- signed URLs expiram, entao a integracao precisa ser bem feita.

### 6. Desativar Backend TTS enquanto a funcao nao existir

Enquanto `readera-tts` nao estiver publicada, o app poderia:

- nao selecionar Backend automaticamente;
- marcar Backend como indisponivel;
- usar Navegador como padrao.

Beneficio:

- menos chamadas 404;
- menos confusao na interface.

---

## Conclusao final

A lentidao observada provavelmente nao vem do numero de documentos na tabela Supabase.

No momento da analise havia apenas:

```txt
6 documentos
```

O problema mais provavel e o tamanho e a forma de carregamento dos PDFs:

```txt
PDF mais recente: aproximadamente 24 MB
```

O app baixa o PDF inteiro do Supabase Storage antes de renderizar.

Se a opcao de retomar o ultimo PDF estiver ligada, esse download pesado acontece logo ao abrir o app.

Se a opcao de auto upload estiver ligada, o app tambem pode consumir banda enviando arquivos para a nuvem e criando duplicatas.

Portanto, o diagnostico principal e:

```txt
Demora causada principalmente por download completo de PDF grande via Supabase Storage,
possivelmente agravada por retomada automatica, auto upload e dispositivo/rede lenta.
```

Recomendacao imediata sem codigo:

```txt
1. Desligar "Ao iniciar, abrir o ultimo PDF da nuvem".
2. Desligar "Enviar PDF para a nuvem ao abrir".
3. Usar "Motor: Navegador" enquanto o backend TTS nao estiver publicado.
4. Evitar PDFs grandes ou duplicados na nuvem.
```

Recomendacao tecnica futura:

```txt
Implementar abertura por URL/streaming ou cache local para evitar baixar o PDF inteiro toda vez.
```
