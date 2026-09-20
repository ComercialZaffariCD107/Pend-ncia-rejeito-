// =====================================
// ESTADO GLOBAL
// =====================================

// bancoMap: "código de barras" (string) -> { codigo, descricao, embalagem }
let bancoMap = new Map();

// pendentesMap: "código reduzido" (string) -> [ linhas pendentes ]
let pendentesMap = new Map();

// stageInMap: "código reduzido" (string) -> [ linhas com situação Pendente ]
let stageInMap = new Map();

// movHorizontalMap: "código reduzido" (string) -> [ linhas ainda na tela ]
let movHorizontalMap = new Map();

let bancoCarregado = false;
let pendentesCarregado = false;
let stageInCarregado = false;
let movHorizontalCarregado = false;

const contadores = {
    total: 0,
    pendente: 0,
    ok: 0
};

// paleteAtual: itens bipados desde a última vez que um palete foi
// fechado. Cada item: { hora, codigoBipado, codigoReduzido, produto,
// tipo, status, telas } — "telas" traz as pendências encontradas em
// cada uma das 3 consultas: { velox:[], stageIn:[], movHorizontal:[] }
let paleteAtual = {
    numero: 1,
    itens: []
};

// =====================================
// DECODIFICAÇÃO DE TEXTO (TXT/CSV)
// =====================================
// Exports do Velox costumam sair em ISO-8859-1 / windows-1252 (acentos
// e símbolos como °, º, ´ quebram se lidos como UTF-8). Se o arquivo
// tiver BOM UTF-8, respeita UTF-8; senão, decodifica como windows-1252.

function decodificarTexto(buffer){

    const bytes = new Uint8Array(buffer);

    const temBOM =
        bytes.length >= 3 &&
        bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;

    let texto = new TextDecoder(temBOM ? "utf-8" : "windows-1252").decode(buffer);

    if(temBOM) texto = texto.slice(1);

    return texto;

}

// =====================================
// CÓDIGO REDUZIDO — NORMALIZAÇÃO
// =====================================
// Cada tela traz o código de um jeito (Movimentação Horizontal usa
// 0018158, Stage-in usa 18158...). Tira espaços e zeros à esquerda
// pra todas as consultas falarem a mesma língua.

function normalizarCodigo(valor){

    return String(valor ?? "").trim().replace(/^0+(?=\d)/, "");

}

function esc(valor){

    return String(valor ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

}

// =====================================
// AS 3 TELAS CONSULTADAS A CADA BIPAGEM
// =====================================
// Para cada tela: como aparece na interface (nome/curto/icone) e
// quais colunas mostrar no detalhe (tela) e no romaneio (impressão).

const TELAS = [

    {
        chave: "velox",
        nome: "Consulta de Pendentes (Velox)",
        curto: "Velox",
        icone: "📋",
        colunas: [
            { titulo:"Etiqueta (DUN)", valor:(p)=> p.etiqueta },
            { titulo:"Descrição",      valor:(p, item)=> item.descricao },
            { titulo:"Posição",        valor:(p)=> p.posicao || "—" },
            { titulo:"Qtd",            valor:(p)=> p.quantidadeTotal },
            { titulo:"Integrado em",   valor:(p)=> p.hIntegrado }
        ],
        impressao: [
            { titulo:"Descrição",    valor:(p, it)=> it.produto },
            { titulo:"Posição",      valor:(p)=> p.posicao || "—", classe:"col-posicao" },
            { titulo:"Qtd",          valor:(p)=> p.quantidadeTotal, classe:"col-qtd" },
            { titulo:"Integrado em", valor:(p)=> p.hIntegrado }
        ]
    },

    {
        chave: "stageIn",
        limiteImpressao: 5,
        nome: "Consulta Stage-in",
        curto: "Stage-in",
        icone: "📥",
        colunas: [
            { titulo:"Stage-in",        valor:(p)=> p.stageIn || "—" },
            { titulo:"Origem",          valor:(p)=> p.origem || "—" },
            { titulo:"Nº Carga",        valor:(p)=> p.carga || "—" },
            { titulo:"Etiqueta",        valor:(p)=> p.etiqueta || "—" },
            { titulo:"Qtd",             valor:(p)=> p.quantidade },
            { titulo:"Endereço Apanha", valor:(p)=> p.enderecoApanha || "—" },
            { titulo:"Movimentado em",  valor:(p)=> p.dataHora }
        ],
        impressao: [
            { titulo:"Stage-in",       valor:(p)=> p.stageIn || "—" },
            { titulo:"Origem",         valor:(p)=> p.origem || "—" },
            { titulo:"Carga",          valor:(p)=> p.carga || "—" },
            { titulo:"Qtd",            valor:(p)=> p.quantidade, classe:"col-qtd" },
            { titulo:"Movimentado em", valor:(p)=> p.dataHora }
        ]
    },

    {
        chave: "movHorizontal",
        limiteImpressao: 5,
        nome: "Movimentação Horizontal",
        curto: "Mov. Horizontal",
        icone: "↔️",
        colunas: [
            { titulo:"Origem",        valor:(p)=> p.origem || "—" },
            { titulo:"Destino",       valor:(p)=> p.destino || "—" },
            { titulo:"Prioridade",    valor:(p)=> p.prioridade || "—" },
            { titulo:"Tempo geração", valor:(p)=> p.tempo || "—" }
        ],
        impressao: [
            { titulo:"Origem",        valor:(p)=> p.origem || "—" },
            { titulo:"Destino",       valor:(p)=> p.destino || "—" },
            { titulo:"Tempo geração", valor:(p)=> p.tempo || "—" }
        ]
    }

];

// Consulta o código reduzido nas 3 telas de uma vez.
function consultarTelas(codigoReduzido){

    const chave = normalizarCodigo(codigoReduzido);

    return {
        velox:         pendentesMap.get(chave) || [],
        stageIn:       stageInMap.get(chave) || [],
        movHorizontal: movHorizontalMap.get(chave) || []
    };

}

// Telas onde o item está pendente (na ordem de TELAS).
function telasComPendencia(telas){

    return TELAS.filter(t => (telas[t.chave] || []).length > 0);

}

// Tags da interface: uma por tela pendente, ou "OK".
function htmlTagsResultado(status, telas){

    if(status !== "pendente"){
        return `<span class="tag tag-ok">✅ OK</span>`;
    }

    return `<div class="tags-telas">` +
        telasComPendencia(telas).map(t =>
            `<span class="tag tag-pendente">⛔ ${t.curto} (${telas[t.chave].length})</span>`
        ).join("") +
        `</div>`;

}

// =====================================
// LEITURA — BANCO DE DADOS (XLSX / CSV / TXT)
// =====================================
// Aceita tanto planilha ("BASE": Código | Descrição | Embalagem |
// Código de barras | Tipo código) quanto exportação em texto do Velox
// separada por ";" (SEQPRODUTO;DESCCOMPLETA;QTDEMBALAGEM;
// CODIGO_BARRAS;TIPO_CODIGO). Cada código reduzido aparece em várias
// linhas — uma por código de barras (DUN e/ou EAN) que ele possui.

async function carregarBanco(file){

    if(!file) return;

    const loadingBox = document.getElementById("loadingBanco");
    const loadingFill = document.getElementById("loadingFillBanco");
    const statusEl = document.getElementById("statusBanco");
    const card = document.getElementById("arquivoBanco").closest(".upload-card");

    loadingBox.style.display = "block";
    loadingFill.style.width = "10%";

    try{

        const nomeArquivo = file.name.toLowerCase();
        const ehTexto = nomeArquivo.endsWith(".txt") || nomeArquivo.endsWith(".csv");

        const buffer = await file.arrayBuffer();

        loadingFill.style.width = "50%";

        bancoMap = new Map();

        if(ehTexto){

            // ---- TXT / CSV (Velox) ----

            const texto = decodificarTexto(buffer);

            const linhas = texto
                .split(/\r\n|\n/)
                .filter(l => l.trim().length > 0);

            if(linhas.length > 0){

                const cabecalho = linhas[0]
                    .split(";")
                    .map(c => c.trim().toUpperCase());

                const acharColuna = (...nomes) =>
                    cabecalho.findIndex(c => nomes.includes(c));

                const idx = {
                    codigo: acharColuna("SEQPRODUTO", "CÓDIGO", "CODIGO"),
                    descricao: acharColuna("DESCCOMPLETA", "DESCRIÇÃO", "DESCRICAO"),
                    embalagem: acharColuna("QTDEMBALAGEM", "EMBALAGEM"),
                    codigoBarras: acharColuna("CODIGO_BARRAS", "CÓDIGO DE BARRAS", "CODIGO DE BARRAS"),
                    tipo: acharColuna("TIPO_CODIGO", "TIPO CÓDIGO", "TIPO CODIGO")
                };

                for(let i = 1; i < linhas.length; i++){

                    const campos = linhas[i].split(";");

                    const codigoBarras =
                        idx.codigoBarras >= 0
                            ? (campos[idx.codigoBarras] ?? "").trim()
                            : "";

                    if(!codigoBarras) continue;

                    bancoMap.set(codigoBarras, {
                        codigo: idx.codigo >= 0 ? (campos[idx.codigo] ?? "").trim() : "",
                        descricao: idx.descricao >= 0 ? (campos[idx.descricao] ?? "").trim() : "",
                        embalagem: idx.embalagem >= 0 ? (campos[idx.embalagem] ?? "").trim() : "",
                        tipo: idx.tipo >= 0 ? (campos[idx.tipo] ?? "").trim() : ""
                    });

                }

            }

        }else{

            // ---- XLSX / XLS ----

            const workbook = XLSX.read(buffer, { type:"array" });

            const sheet =
                workbook.Sheets["BASE"] ||
                workbook.Sheets[workbook.SheetNames[0]];

            const linhas = XLSX.utils.sheet_to_json(sheet, { defval:"" });

            for(const linha of linhas){

                const codigoBarras =
                    String(
                        linha["Código de barras"] ??
                        linha["Codigo de barras"] ??
                        ""
                    ).trim();

                if(!codigoBarras) continue;

                bancoMap.set(codigoBarras, {
                    codigo: String(linha["Código"] ?? linha["Codigo"] ?? "").trim(),
                    descricao: String(linha["Descrição"] ?? linha["Descricao"] ?? "").trim(),
                    embalagem: linha["Embalagem"] ?? "",
                    tipo: String(linha["Tipo código"] ?? linha["Tipo codigo"] ?? "").trim()
                });

            }

        }

        loadingFill.style.width = "100%";

        bancoCarregado = true;

        statusEl.innerHTML =
            `✅ ${file.name} — ${bancoMap.size.toLocaleString("pt-BR")} códigos`;

        card.classList.add("pronto");

        verificarProntoParaBipar();

    }catch(err){

        console.error(err);

        statusEl.textContent = "❌ Erro ao ler o arquivo. Confira o formato.";

    }

    setTimeout(()=>{ loadingBox.style.display = "none"; }, 400);

}

// =====================================
// LEITURA — CONSULTA DE PENDENTES (VELOX)
// =====================================
// CSV separado por ";", com BOM UTF-8 e quebras de linha CRLF.
// Coluna "Etiqueta" vem cercada de pipes: |17898556120330|
//
// Colunas:
// Etiqueta;Tipo;(Global)H. Integrado;Produto;(Sorter)Status;
// (Palete)Master;(Palete)Posição;(Caixa)Status no Palete;
// tipEspecie;quantidadeTotal;Código do produto

// =====================================
// ORDENAÇÃO DAS PENDÊNCIAS POR POSIÇÃO (Z-A)
// =====================================
// Posição no formato "PTL-{rampa}-{coluna}". A operação anda da
// rampa 23 até a rampa 1, então as pendências sempre aparecem
// ordenadas da rampa maior pra menor (e, dentro da rampa, da coluna
// maior pra menor) — tanto na tela quanto na impressão.

function extrairPosicaoOrdenavel(posicao){

    if(!posicao) return [-Infinity, -Infinity];

    const match = posicao.match(/PTL-(\d+)-(\d+)/i);

    if(match) return [parseInt(match[1], 10), parseInt(match[2], 10)];

    const numeros = (posicao.match(/\d+/g) || []).map(Number);

    return [numeros[0] ?? -Infinity, numeros[1] ?? -Infinity];

}

function compararPosicaoDesc(a, b){

    const [rampaA, colunaA] = extrairPosicaoOrdenavel(a.posicao);
    const [rampaB, colunaB] = extrairPosicaoOrdenavel(b.posicao);

    if(rampaB !== rampaA) return rampaB - rampaA;

    return colunaB - colunaA;

}

async function carregarPendentes(file){

    if(!file) return;

    const loadingBox = document.getElementById("loadingPendentes");
    const loadingFill = document.getElementById("loadingFillPendentes");
    const statusEl = document.getElementById("statusPendentes");
    const card = document.getElementById("arquivoPendentes").closest(".upload-card");

    loadingBox.style.display = "block";
    loadingFill.style.width = "20%";

    try{

        const buffer = await file.arrayBuffer();

        const texto = decodificarTexto(buffer);

        loadingFill.style.width = "50%";

        const linhas = texto
            .split(/\r\n|\n/)
            .filter(l => l.trim().length > 0);

        pendentesMap = new Map();

        for(let i = 1; i < linhas.length; i++){

            const campos = linhas[i].split(";");

            if(campos.length < 11) continue;

            const etiqueta = campos[0].replace(/\|/g, "").trim();
            const codigoProduto = campos[10].trim();

            if(!codigoProduto) continue;

            const registro = {
                etiqueta,
                tipo: campos[1].trim(),
                hIntegrado: campos[2].trim(),
                produto: campos[3].trim(),
                statusSorter: campos[4].trim(),
                master: campos[5].trim(),
                posicao: campos[6].trim(),
                statusCaixa: campos[7].trim(),
                tipEspecie: campos[8].trim(),
                quantidadeTotal: campos[9].trim(),
                codigoProduto
            };

            const chaveProduto = normalizarCodigo(codigoProduto);

            if(!pendentesMap.has(chaveProduto)){
                pendentesMap.set(chaveProduto, []);
            }

            pendentesMap.get(chaveProduto).push(registro);

        }

        loadingFill.style.width = "100%";

        // ordena cada lista de pendências por posição, da rampa 23
        // até a rampa 1 (Z-A), pra bater com o sentido da operação
        for(const lista of pendentesMap.values()){
            lista.sort(compararPosicaoDesc);
        }

        pendentesCarregado = true;

        const totalLinhas = linhas.length - 1;

        statusEl.innerHTML =
            `✅ ${file.name} — ${totalLinhas.toLocaleString("pt-BR")} pendências, ${pendentesMap.size.toLocaleString("pt-BR")} produtos`;

        card.classList.add("pronto");

        verificarProntoParaBipar();

    }catch(err){

        console.error(err);

        statusEl.textContent = "❌ Erro ao ler o arquivo. Confira o formato.";

    }

    setTimeout(()=>{ loadingBox.style.display = "none"; }, 400);

}

// =====================================
// LEITURA — CONSULTA STAGE-IN
// =====================================
// TXT/CSV separado por ";" (ISO-8859-1), uma linha por volume:
// DTAHORMOVIMENTACAO;ORIGEM;NROCARGA;DESCRICAO;ETIQUETA;DEPOSITANTE;
// CODIGO;DESCRICAO;EMBALAGEM;QUANTIDADE;ETIQUETA_VOLUME;STAGEIN;
// SITUACAO;ENDERECO_APANHA
//
// Regra: só entra quem está com SITUACAO = "Pendente".
// Chave de busca: CODIGO (código reduzido).

function semAcentoMinusculo(texto){

    return String(texto ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();

}

function parseStageIn(linhas){

    if(linhas.length < 2) throw new Error("Arquivo sem linhas de dados.");

    const cab = linhas[0].split(";").map(c => semAcentoMinusculo(c));

    const achar = (...nomes) => cab.findIndex(c => nomes.includes(c));

    const iCodigo = achar("codigo");
    const iSituacao = achar("situacao");

    if(iCodigo < 0){
        throw new Error('Coluna "CODIGO" não encontrada. Confira se é o arquivo da Consulta Stage-in.');
    }

    // o arquivo tem duas colunas "DESCRICAO": a 1ª é da carga, a
    // última é a do produto
    const iDescProduto = cab.lastIndexOf("descricao");

    const iDataHora = achar("dtahormovimentacao");
    const iOrigem = achar("origem");
    const iCarga = achar("nrocarga");
    const iEtiqueta = achar("etiqueta");
    const iEmbalagem = achar("embalagem");
    const iQuantidade = achar("quantidade");
    const iStageIn = achar("stagein");
    const iEndApanha = achar("endereco_apanha");

    const pega = (campos, i) => i >= 0 ? (campos[i] ?? "").trim() : "";

    const mapa = new Map();
    let total = 0;

    for(let i = 1; i < linhas.length; i++){

        const campos = linhas[i].split(";");

        const codigo = normalizarCodigo(campos[iCodigo]);

        if(!codigo) continue;

        // só "Pendente" (se a coluna existir)
        if(iSituacao >= 0 && semAcentoMinusculo(campos[iSituacao]) !== "pendente") continue;

        const registro = {
            dataHora: pega(campos, iDataHora),
            origem: pega(campos, iOrigem),
            carga: pega(campos, iCarga),
            etiqueta: pega(campos, iEtiqueta),
            descricao: pega(campos, iDescProduto),
            embalagem: pega(campos, iEmbalagem),
            quantidade: pega(campos, iQuantidade),
            stageIn: pega(campos, iStageIn),
            enderecoApanha: pega(campos, iEndApanha)
        };

        if(!mapa.has(codigo)) mapa.set(codigo, []);

        mapa.get(codigo).push(registro);

        total++;

    }

    return { mapa, total, rotulo: "pendências" };

}

// =====================================
// LEITURA — MOVIMENTAÇÃO HORIZONTAL
// =====================================
// TXT/CSV separado por ";":
// P;ORIGEM;DESTINO;PRODUTO;TEMPO_GERACAO
//
// PRODUTO vem como "0018158 - CHOCOTTONE BAUDUCCO 450G MOUSSE-".
// Não existe coluna de situação: estar na tela = ainda pendente.
// Chave de busca: número antes do " - " (sem zeros à esquerda).

function parseMovHorizontal(linhas){

    if(linhas.length < 2) throw new Error("Arquivo sem linhas de dados.");

    const cab = linhas[0].split(";").map(c => semAcentoMinusculo(c));

    const achar = (...nomes) => cab.findIndex(c => nomes.includes(c));

    const iProduto = achar("produto");

    if(iProduto < 0){
        throw new Error('Coluna "PRODUTO" não encontrada. Confira se é o arquivo da Movimentação Horizontal.');
    }

    const iPrioridade = achar("p");
    const iOrigem = achar("origem");
    const iDestino = achar("destino");
    const iTempo = achar("tempo_geracao");

    const pega = (campos, i) => i >= 0 ? (campos[i] ?? "").trim() : "";

    const mapa = new Map();
    let total = 0;

    for(let i = 1; i < linhas.length; i++){

        const campos = linhas[i].split(";");

        const produtoBruto = (campos[iProduto] ?? "").trim();

        const m = produtoBruto.match(/^(\d+)\s*-\s*(.*)$/);

        if(!m) continue;

        const codigo = normalizarCodigo(m[1]);

        const registro = {
            prioridade: pega(campos, iPrioridade),
            origem: pega(campos, iOrigem),
            destino: pega(campos, iDestino),
            descricao: m[2].trim(),
            tempo: pega(campos, iTempo)
        };

        if(!mapa.has(codigo)) mapa.set(codigo, []);

        mapa.get(codigo).push(registro);

        total++;

    }

    return { mapa, total, rotulo: "movimentações" };

}

// Carregador genérico dos dois arquivos de texto novos (mesma
// experiência dos cards antigos: barra de progresso + status).

async function carregarArquivoConsulta(file, cfg){

    if(!file) return;

    const loadingBox = document.getElementById(cfg.loadingId);
    const loadingFill = document.getElementById(cfg.fillId);
    const statusEl = document.getElementById(cfg.statusId);
    const card = document.getElementById(cfg.inputId).closest(".upload-card");

    loadingBox.style.display = "block";
    loadingFill.style.width = "20%";

    try{

        const buffer = await file.arrayBuffer();

        const texto = decodificarTexto(buffer);

        loadingFill.style.width = "50%";

        const linhas = texto
            .split(/\r\n|\n/)
            .filter(l => l.trim().length > 0);

        const resultado = cfg.parse(linhas);

        cfg.aplicar(resultado.mapa);

        loadingFill.style.width = "100%";

        statusEl.innerHTML =
            `✅ ${esc(file.name)} — ${resultado.total.toLocaleString("pt-BR")} ${resultado.rotulo}, ${resultado.mapa.size.toLocaleString("pt-BR")} produtos`;

        card.classList.add("pronto");

        verificarProntoParaBipar();

    }catch(err){

        console.error(err);

        statusEl.textContent = "❌ " + (err.message || "Erro ao ler o arquivo. Confira o formato.");

        card.classList.remove("pronto");

    }

    setTimeout(()=>{ loadingBox.style.display = "none"; }, 400);

}

function carregarStageIn(file){

    return carregarArquivoConsulta(file, {
        inputId: "arquivoStageIn",
        loadingId: "loadingStageIn",
        fillId: "loadingFillStageIn",
        statusId: "statusStageIn",
        parse: parseStageIn,
        aplicar: (mapa)=>{ stageInMap = mapa; stageInCarregado = true; }
    });

}

function carregarMovHorizontal(file){

    return carregarArquivoConsulta(file, {
        inputId: "arquivoMovHorizontal",
        loadingId: "loadingMovHorizontal",
        fillId: "loadingFillMovHorizontal",
        statusId: "statusMovHorizontal",
        parse: parseMovHorizontal,
        aplicar: (mapa)=>{ movHorizontalMap = mapa; movHorizontalCarregado = true; }
    });

}

// =====================================
// LIBERA O CAMPO DE BIPAGEM
// =====================================
// Só libera com os 4 arquivos carregados — senão uma tela
// esquecida viraria um falso "sem pendência".

function verificarProntoParaBipar(){

    const input = document.getElementById("inputScan");
    const dica = document.getElementById("scanDica");

    const faltando = [];

    if(!bancoCarregado) faltando.push("Banco de Dados");
    if(!pendentesCarregado) faltando.push("Consulta de Pendentes");
    if(!stageInCarregado) faltando.push("Consulta Stage-in");
    if(!movHorizontalCarregado) faltando.push("Movimentação Horizontal");

    if(faltando.length === 0){

        input.disabled = false;
        input.focus();

        dica.textContent =
            "Pronto — bipe o código de barras da caixa (DUN ou EAN). Consulta Velox, Stage-in e Movimentação Horizontal.";

    }else{

        dica.textContent =
            "Falta carregar: " + faltando.join(", ") + ".";

    }

}

// =====================================
// BIPAGEM
// =====================================

const inputScan = document.getElementById("inputScan");

// Bipagem automática (padrão): o leitor sem fio "digita" tudo em
// poucos milissegundos e depois para. A cada tecla reinicia um
// cronômetro curto; quando o campo fica esse tempinho sem receber
// nada, dispara a busca sozinho — sem precisar de Enter.
//
// Modo "Digitar" (opcional, pelo checkbox ao lado do campo): desliga
// o disparo automático — só busca quando aperta Enter. Útil pra
// digitar o código manualmente sem disparar buscas no meio da
// digitação (código incompleto vira leitura errada).

const SCAN_DEBOUNCE_MS = 120;

let scanTimer = null;
let modoDigitacaoLivre = false;

function dispararLeitura(){

    if(scanTimer){
        clearTimeout(scanTimer);
        scanTimer = null;
    }

    const valor = inputScan.value;

    if(valor.trim().length === 0) return;

    processarLeitura(valor);

    inputScan.value = "";

}

inputScan.addEventListener("input", ()=>{

    if(modoDigitacaoLivre) return; // só busca no Enter

    if(scanTimer) clearTimeout(scanTimer);

    scanTimer = setTimeout(dispararLeitura, SCAN_DEBOUNCE_MS);

});

// Enter sempre funciona — dispara na hora, nos dois modos.

inputScan.addEventListener("keydown", (e)=>{

    if(e.key === "Enter"){

        e.preventDefault();

        dispararLeitura();

    }

});

// Se o campo perder o foco (ex: clique sem querer em outro
// lugar), volta o foco pra ele sozinho, pra não travar a
// bipagem contínua.

inputScan.addEventListener("blur", ()=>{

    if(!inputScan.disabled){

        setTimeout(()=> inputScan.focus(), 150);

    }

});

function alternarModoDigitacao(ativo){

    modoDigitacaoLivre = ativo;

    if(scanTimer){
        clearTimeout(scanTimer);
        scanTimer = null;
    }

    inputScan.placeholder = ativo
        ? "Digite o código e aperte Enter..."
        : "Bipe o código de barras aqui...";

    if(!inputScan.disabled) inputScan.focus();

}

// Aviso visual rápido (sem gravar nada) quando o código bipado não
// existe no Banco de Dados carregado.

function sinalizarCodigoNaoCadastrado(){

    inputScan.classList.add("scan-input-erro");

    setTimeout(()=> inputScan.classList.remove("scan-input-erro"), 350);

}

function sinalizarItemDuplicado(){

    inputScan.classList.add("scan-input-aviso");

    setTimeout(()=> inputScan.classList.remove("scan-input-aviso"), 350);

}

function mostrarResultadoDuplicado(item, codigoBipado, itemExistente){

    const card = document.getElementById("resultadoCard");

    const linha = paleteAtual.itens.indexOf(itemExistente) + 1;

    card.innerHTML = `
        <div class="resultado-conteudo status-duplicado">
            <div class="resultado-topo">
                <div class="resultado-produto">
                    <h2>${item.descricao}</h2>
                    <p>Código reduzido: ${item.codigo} • Bipado: ${codigoBipado} (${item.tipo})</p>
                </div>
                <div class="resultado-selo">⚠️ Já Bipado Neste Palete</div>
            </div>
            <p style="color:var(--muted); font-size:.85rem;">
                Esse item já está no palete atual — linha ${linha}, ${itemExistente.hora}.
                Bipagem ignorada pra não duplicar. Se for outra caixa de verdade,
                feche este palete antes de bipar de novo.
            </p>
        </div>
    `;

}

function processarLeitura(codigoBipado){

    codigoBipado = codigoBipado.replace(/\D/g, "").trim();

    if(!codigoBipado) return;

    const item = bancoMap.get(codigoBipado);

    // Código não cadastrado no Banco de Dados: ignora por completo —
    // não conta no KPI, não entra no histórico nem no palete. Só um
    // sinal visual rápido no campo pra avisar que não achou nada.

    if(!item){

        sinalizarCodigoNaoCadastrado();

        return;

    }

    // Mesmo item (código reduzido) já bipado nesse palete: não deixa
    // duplicar. Mostra onde ele já está e ignora a nova leitura.

    const itemExistente = paleteAtual.itens.find(it => it.codigoReduzido === item.codigo);

    if(itemExistente){

        sinalizarItemDuplicado();

        mostrarResultadoDuplicado(item, codigoBipado, itemExistente);

        return;

    }

    contadores.total++;

    const agora = new Date();

    const hora = agora.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", second:"2-digit" });

    // consulta as 3 telas de uma vez: Velox, Stage-in e Mov. Horizontal
    const telas = consultarTelas(item.codigo);

    const pendente = telasComPendencia(telas).length > 0;

    const registro = {
        hora,
        codigoBipado,
        codigoReduzido: item.codigo,
        produto: item.descricao,
        tipo: item.tipo,
        status: pendente ? "pendente" : "ok",
        telas
    };

    if(pendente) contadores.pendente++;
    else contadores.ok++;

    mostrarResultado({
        status: registro.status,
        codigoBipado,
        item,
        telas
    });

    registrarHistorico(registro);

    adicionarAoPalete(registro);

    atualizarKpis();

}

// =====================================
// RENDER — RESULTADO
// =====================================

function mostrarResultado({ status, codigoBipado, item, telas }){

    const card = document.getElementById("resultadoCard");

    const pendentes = telasComPendencia(telas);

    // resumo das 3 telas — sempre aparece, pra deixar claro que as
    // três foram consultadas e onde está (ou não) a pendência
    const chips = TELAS.map(t => {

        const qtd = telas[t.chave].length;

        return `
            <div class="tela-chip ${qtd > 0 ? "tela-chip-pendente" : "tela-chip-livre"}">
                <span class="tela-chip-nome">${t.icone} ${t.nome}</span>
                <strong>${qtd > 0 ? `⛔ Pendente (${qtd})` : "✅ Sem pendência"}</strong>
            </div>
        `;

    }).join("");

    if(status === "ok"){

        card.innerHTML = `
            <div class="resultado-conteudo status-ok">
                <div class="resultado-topo">
                    <div class="resultado-produto">
                        <h2>${esc(item.descricao)}</h2>
                        <p>Código reduzido: ${esc(item.codigo)} • Bipado: ${esc(codigoBipado)} (${esc(item.tipo)})</p>
                    </div>
                    <div class="resultado-selo">✅ Sem Pendência</div>
                </div>
                <div class="telas-resumo">${chips}</div>
            </div>
        `;

        return;

    }

    // status === "pendente"

    const blocos = pendentes.map(t => {

        const lista = telas[t.chave];

        const cabecalho = t.colunas
            .map(c => `<th>${c.titulo}</th>`)
            .join("");

        const linhas = lista.map(p => `
            <tr>
                ${t.colunas.map(c => `<td>${esc(c.valor(p, item))}</td>`).join("")}
            </tr>
        `).join("");

        return `
            <div class="tela-bloco">
                <h4 class="tela-titulo">
                    ${t.icone} ${t.nome}
                    <span class="tela-contagem">${lista.length}</span>
                </h4>
                <div class="resultado-detalhe">
                    <table>
                        <thead><tr>${cabecalho}</tr></thead>
                        <tbody>${linhas}</tbody>
                    </table>
                </div>
            </div>
        `;

    }).join("");

    card.innerHTML = `
        <div class="resultado-conteudo status-pendente">
            <div class="resultado-topo">
                <div class="resultado-produto">
                    <h2>${esc(item.descricao)}</h2>
                    <p>Código reduzido: ${esc(item.codigo)} • Bipado: ${esc(codigoBipado)} (${esc(item.tipo)})</p>
                </div>
                <div class="resultado-selo">⛔ Pendente em ${pendentes.map(t => t.curto).join(" + ")}</div>
            </div>
            <div class="telas-resumo">${chips}</div>
            ${blocos}
        </div>
    `;

}

// =====================================
// RENDER — HISTÓRICO
// =====================================

function registrarHistorico({ hora, codigoBipado, codigoReduzido, produto, status, telas }){

    const tbody = document.getElementById("historicoBody");

    const vazio = document.getElementById("historicoVazio");
    if(vazio) vazio.remove();

    const tr = document.createElement("tr");

    tr.innerHTML = `
        <td>${hora}</td>
        <td>${codigoBipado}</td>
        <td>${codigoReduzido}</td>
        <td>${esc(produto)}</td>
        <td>${htmlTagsResultado(status, telas)}</td>
    `;

    tbody.prepend(tr);

}

// =====================================
// PALETE — ACUMULA BIPAGENS ATÉ FECHAR
// =====================================
// Cada item bipado entra no palete atual, seja qual for o resultado
// (pendente, ok ou não cadastrado). O palete só reinicia quando o
// usuário clica em "Fechar Palete".

function adicionarAoPalete(registro){

    paleteAtual.itens.push(registro);

    renderizarPalete();

}

function renderizarPalete(){

    const numeroEl = document.getElementById("paleteNumero");
    const contagemEl = document.getElementById("paleteContagem");
    const tbody = document.getElementById("paleteBody");
    const btnFechar = document.getElementById("btnFecharPalete");

    numeroEl.textContent = paleteAtual.numero;
    contagemEl.textContent = paleteAtual.itens.length;

    btnFechar.disabled = paleteAtual.itens.length === 0;

    if(paleteAtual.itens.length === 0){

        tbody.innerHTML = `
            <tr id="paleteVazio">
                <td colspan="5" class="historico-vazio-linha">
                    Nenhum item bipado neste palete ainda.
                </td>
            </tr>
        `;

        return;

    }

    tbody.innerHTML = paleteAtual.itens.map((it, idx) => `
        <tr>
            <td>${idx + 1}</td>
            <td>${it.hora}</td>
            <td>${it.codigoBipado}</td>
            <td>${esc(it.produto)}</td>
            <td>${htmlTagsResultado(it.status, it.telas)}</td>
        </tr>
    `).join("");

}

function fecharPalete(){

    if(paleteAtual.itens.length === 0) return;

    document.getElementById("modalPaleteNumero").textContent = paleteAtual.numero;
    document.getElementById("modalPaleteContagem").textContent = paleteAtual.itens.length;

    document.getElementById("modalImprimir").classList.add("aberto");

}

function fecharModalImprimir(){

    document.getElementById("modalImprimir").classList.remove("aberto");

}

function confirmarImpressao(imprimir){

    fecharModalImprimir();

    if(imprimir){
        gerarImpressaoPalete();
    }

    iniciarNovoPalete();

    if(imprimir){
        // pequeno atraso pra garantir que o modal já sumiu e a área
        // de impressão foi montada antes de abrir o diálogo do
        // navegador (onde aparecem as impressoras cadastradas,
        // inclusive de rede).
        setTimeout(()=> window.print(), 150);
    }

}

function iniciarNovoPalete(){

    paleteAtual = {
        numero: paleteAtual.numero + 1,
        itens: []
    };

    renderizarPalete();

    if(!inputScan.disabled) inputScan.focus();

}

function gerarImpressaoPalete(){

    const area = document.getElementById("areaImpressao");

    const dataHora = new Date().toLocaleString("pt-BR");

    let totalPendencias = 0;

    const blocos = paleteAtual.itens.map((it, idx) => {

        const pendentes = telasComPendencia(it.telas);

        const ehPendente = it.status === "pendente" && pendentes.length > 0;

        const borda = ehPendente ? "imp-borda-pendente" : "imp-borda-ok";

        // uma pílula por tela pendente (ou "sem pendência")
        const pilulas = ehPendente
            ? pendentes.map(t =>
                `<span class="imp-status imp-pendente">⛔ ${t.curto.toUpperCase()} (${it.telas[t.chave].length})</span>`
              ).join("")
            : `<span class="imp-status imp-ok">✅ SEM PENDÊNCIA</span>`;

        // uma subtabela por tela pendente
        const subtabelas = pendentes.map(t => {

            const lista = it.telas[t.chave];

            totalPendencias += lista.length;

            // Stage-in / Mov. Horizontal podem ter dezenas de linhas por
            // produto — no papel mostra só as primeiras e resume o resto
            const exibidas = t.limiteImpressao
                ? lista.slice(0, t.limiteImpressao)
                : lista;

            const ocultas = lista.length - exibidas.length;

            const cabecalho = t.impressao
                .map(c => `<th class="${c.classe || ""}">${c.titulo}</th>`)
                .join("");

            let linhas = exibidas.map(p => `
                <tr>
                    ${t.impressao.map(c => `<td class="${c.classe || ""}">${esc(c.valor(p, it))}</td>`).join("")}
                </tr>
            `).join("");

            if(ocultas > 0){

                linhas += `
                <tr>
                    <td colspan="${t.impressao.length}" class="imp-mais">
                        + ${ocultas} ${ocultas > 1 ? "linhas" : "linha"} não impressa${ocultas > 1 ? "s" : ""} (total: ${lista.length}) — ver na tela
                    </td>
                </tr>`;

            }

            return `
                <div class="impressao-tela-titulo">${t.icone} ${t.nome}</div>
                <table class="impressao-subtabela ${t.chave === "velox" ? "" : "sub-simples"}">
                    <thead><tr>${cabecalho}</tr></thead>
                    <tbody>${linhas}</tbody>
                </table>
            `;

        }).join("");

        return `
            <div class="impressao-item ${borda}">

                <div class="impressao-item-topo">
                    <span class="impressao-item-num">${idx + 1}</span>
                    <span class="impressao-item-hora">${it.hora}</span>
                    <span class="impressao-item-codigo">${it.codigoBipado}<br><small>(${it.codigoReduzido})</small></span>
                    <span class="impressao-item-produto">${esc(it.produto)}</span>
                    <span class="imp-status-grupo">${pilulas}</span>
                </div>

                ${subtabelas}

            </div>
        `;

    }).join("");

    area.innerHTML = `
        <div class="impressao-cabecalho">
            <div>
                <h1>Comercial Zaffari • CD-107</h1>
                <h2>Romaneio de Palete — Nº ${paleteAtual.numero}</h2>
                <p>Gerado em ${dataHora} • Sentido de conferência: rampa 23 → rampa 1</p>
            </div>
            <div class="impressao-selo-total">
                <strong>${paleteAtual.itens.length}</strong>
                <span>item(ns) bipado(s)</span>
            </div>
        </div>
        ${blocos}
        <div class="impressao-rodape">
            Consulta de Pendentes — Sorter • CD-107 • ${totalPendencias} pendência(s) neste palete (Velox + Stage-in + Mov. Horizontal)
        </div>
    `;

}

// =====================================
// KPIs
// =====================================

function atualizarKpis(){

    document.getElementById("kpiTotal").textContent = contadores.total;
    document.getElementById("kpiPendente").textContent = contadores.pendente;
    document.getElementById("kpiOk").textContent = contadores.ok;

}

// =====================================
// LIMPAR SESSÃO
// =====================================

function limparSessao(){

    contadores.total = 0;
    contadores.pendente = 0;
    contadores.ok = 0;

    atualizarKpis();

    document.getElementById("resultadoCard").innerHTML =
        `<div class="resultado-vazio" id="resultadoVazio">📡 Aguardando leitura...</div>`;

    document.getElementById("historicoBody").innerHTML =
        `<tr id="historicoVazio"><td colspan="5" class="historico-vazio-linha">Nenhuma leitura ainda.</td></tr>`;

    paleteAtual = { numero: 1, itens: [] };

    renderizarPalete();

    if(!inputScan.disabled) inputScan.focus();

}

// =====================================
// INICIALIZAÇÃO
// =====================================

renderizarPalete();
