# Consulta Rejeito — Sorter (CD-107)

Ferramenta estática para consultar, em tempo real, se um item está com
volumes pendentes no Sorter — bipando o código de barras (DUN ou EAN)
diretamente com um leitor sem fio.

## Como usar

1. No início do turno, carregue os quatro arquivos:
   - **Banco de Dados** (`.xlsx`) — planilha com as colunas
     `Código | Descrição | Embalagem | Código de barras | Tipo código`.
   - **Consulta de Pendentes** (`.csv`/`.txt`) — exportação do Velox
     (Invent System) com os volumes pendentes do Sorter.
   - **Consulta Stage-in** (`.txt`/`.csv`) — só entram as linhas com
     `SITUACAO = Pendente`; a chave é a coluna `CODIGO`.
   - **Movimentação Horizontal** (`.txt`/`.csv`) — estar na tela já
     significa pendente; a chave é o número antes do " - " na coluna
     `PRODUTO` (zeros à esquerda são ignorados).
2. Assim que os quatro carregarem, o campo de bipagem libera sozinho e
   já fica em foco.
3. Aponte o leitor de código de barras pra caixa (DUN) ou pro produto
   (EAN) — o sistema converte pro código reduzido, consulta as **três
   telas** ao mesmo tempo e mostra em qual(is) delas o item está
   pendente, com o detalhe de cada uma.
4. O campo volta a ficar em foco automaticamente depois de cada leitura,
   pra bipagem contínua sem precisar clicar em nada.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub.
2. Envie para a raiz do repositório: `index.html`, `style.css`, `app.js`,
   `.nojekyll` e este `README.md`.
3. No GitHub, abra **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Selecione a branch `main` e a pasta `/(root)`.
6. Clique em **Save**.

O site é 100% estático (sem backend) — os arquivos carregados ficam só
no navegador de quem está usando, nada é enviado pra nenhum servidor.
