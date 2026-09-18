// =====================================
// ESTADO GLOBAL
// =====================================

// bancoMap: "código de barras" (string) -> { codigo, descricao, embalagem }
let bancoMap = new Map();

// pendentesMap: "código reduzido" (string) -> [ linhas pendentes ]
let pendentesMap = new Map();

let bancoCarregado = false;
let pendentesCarregado = false;

const contadores = {
    total: 0,
    pendente: 0,
    ok: 0,
    naoEncontrado: 0
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

            if(!pendentesMap.has(codigoProduto)){
                pendentesMap.set(codigoProduto, []);
            }

            pendentesMap.get(codigoProduto).push(registro);

        }

        loadingFill.style.width = "100%";

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
// LIBERA O CAMPO DE BIPAGEM
// =====================================

function verificarProntoParaBipar(){

    const input = document.getElementById("inputScan");
    const dica = document.getElementById("scanDica");

    if(bancoCarregado && pendentesCarregado){

        input.disabled = false;
        input.focus();

        dica.textContent =
            "Pronto — bipe o código de barras da caixa (DUN ou EAN).";

    }

}

// =====================================
// BIPAGEM
// =====================================

const inputScan = document.getElementById("inputScan");

inputScan.addEventListener("keydown", (e)=>{

    if(e.key === "Enter"){

        e.preventDefault();

        processarLeitura(inputScan.value);

        inputScan.value = "";

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

function processarLeitura(codigoBipado){

    codigoBipado = codigoBipado.replace(/\D/g, "").trim();

    if(!codigoBipado) return;

    contadores.total++;

    const item = bancoMap.get(codigoBipado);

    const agora = new Date();

    const hora = agora.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", second:"2-digit" });

    if(!item){

        contadores.naoEncontrado++;

        mostrarResultado({
            status: "nao-encontrado",
            codigoBipado
        });

        registrarHistorico({
            hora,
            codigoBipado,
            codigoReduzido: "—",
            produto: "Não cadastrado no banco de dados",
            status: "nao-encontrado"
        });

        atualizarKpis();

        return;

    }

    const pendencias = pendentesMap.get(item.codigo) || [];

    if(pendencias.length > 0){

        contadores.pendente++;

        mostrarResultado({
            status: "pendente",
            codigoBipado,
            item,
            pendencias
        });

        registrarHistorico({
            hora,
            codigoBipado,
            codigoReduzido: item.codigo,
            produto: item.descricao,
            status: "pendente",
            qtd: pendencias.length
        });

    }else{

        contadores.ok++;

        mostrarResultado({
            status: "ok",
            codigoBipado,
            item
        });

        registrarHistorico({
            hora,
            codigoBipado,
            codigoReduzido: item.codigo,
            produto: item.descricao,
            status: "ok"
        });

    }

    atualizarKpis();

}

// =====================================
// RENDER — RESULTADO
// =====================================

function mostrarResultado({ status, codigoBipado, item, pendencias }){

    const card = document.getElementById("resultadoCard");

    if(status === "nao-encontrado"){

        card.innerHTML = `
            <div class="resultado-conteudo status-nao-encontrado">
                <div class="resultado-topo">
                    <div class="resultado-produto">
                        <h2>Código não cadastrado</h2>
                        <p>Bipado: ${codigoBipado}</p>
                    </div>
                    <div class="resultado-selo">❔ Não Encontrado</div>
                </div>
                <p style="color:var(--muted); font-size:.85rem;">
                    Esse código de barras não existe no Banco de Dados carregado.
                    Confira se bipou certo ou se o cadastro está atualizado.
                </p>
            </div>
        `;

        return;

    }

    if(status === "ok"){

        card.innerHTML = `
            <div class="resultado-conteudo status-ok">
                <div class="resultado-topo">
                    <div class="resultado-produto">
                        <h2>${item.descricao}</h2>
                        <p>Código reduzido: ${item.codigo} • Bipado: ${codigoBipado} (${item.tipo})</p>
                    </div>
                    <div class="resultado-selo">✅ Sem Pendência</div>
                </div>
            </div>
        `;

        return;

    }

    // status === "pendente"

    const linhas = pendencias.map(p => `
        <tr>
            <td>${p.etiqueta}</td>
            <td>${p.master || "—"}</td>
            <td>${p.posicao || "—"}</td>
            <td>${p.tipo}</td>
            <td>${p.quantidadeTotal}</td>
            <td>${p.hIntegrado}</td>
        </tr>
    `).join("");

    card.innerHTML = `
        <div class="resultado-conteudo status-pendente">
            <div class="resultado-topo">
                <div class="resultado-produto">
                    <h2>${item.descricao}</h2>
                    <p>Código reduzido: ${item.codigo} • Bipado: ${codigoBipado} (${item.tipo})</p>
                </div>
                <div class="resultado-selo">⛔ ${pendencias.length} Pendente${pendencias.length > 1 ? "s" : ""}</div>
            </div>
            <div class="resultado-detalhe">
                <table>
                    <thead>
                        <tr>
                            <th>Etiqueta (DUN)</th>
                            <th>Master</th>
                            <th>Posição</th>
                            <th>Tipo</th>
                            <th>Qtd</th>
                            <th>Integrado em</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${linhas}
                    </tbody>
                </table>
            </div>
        </div>
    `;

}

// =====================================
// RENDER — HISTÓRICO
// =====================================

function registrarHistorico({ hora, codigoBipado, codigoReduzido, produto, status, qtd }){

    const tbody = document.getElementById("historicoBody");

    const vazio = document.getElementById("historicoVazio");
    if(vazio) vazio.remove();

    const tagInfo = {
        "pendente": { classe:"tag-pendente", texto:`⛔ ${qtd} Pendente${qtd > 1 ? "s" : ""}` },
        "ok": { classe:"tag-ok", texto:"✅ OK" },
        "nao-encontrado": { classe:"tag-nao-encontrado", texto:"❔ Não Cadastrado" }
    }[status];

    const tr = document.createElement("tr");

    tr.innerHTML = `
        <td>${hora}</td>
        <td>${codigoBipado}</td>
        <td>${codigoReduzido}</td>
        <td>${produto}</td>
        <td><span class="tag ${tagInfo.classe}">${tagInfo.texto}</span></td>
    `;

    tbody.prepend(tr);

}

// =====================================
// KPIs
// =====================================

function atualizarKpis(){

    document.getElementById("kpiTotal").textContent = contadores.total;
    document.getElementById("kpiPendente").textContent = contadores.pendente;
    document.getElementById("kpiOk").textContent = contadores.ok;
    document.getElementById("kpiNaoEncontrado").textContent = contadores.naoEncontrado;

}

// =====================================
// LIMPAR SESSÃO
// =====================================

function limparSessao(){

    contadores.total = 0;
    contadores.pendente = 0;
    contadores.ok = 0;
    contadores.naoEncontrado = 0;

    atualizarKpis();

    document.getElementById("resultadoCard").innerHTML =
        `<div class="resultado-vazio" id="resultadoVazio">📡 Aguardando leitura...</div>`;

    document.getElementById("historicoBody").innerHTML =
        `<tr id="historicoVazio"><td colspan="5" class="historico-vazio-linha">Nenhuma leitura ainda.</td></tr>`;

    if(!inputScan.disabled) inputScan.focus();

}
