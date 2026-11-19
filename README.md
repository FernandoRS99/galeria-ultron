# Galeria Ultron — reprodução local

Página estática preparada para o GitHub Pages. A hospedagem recebe somente
HTML e JavaScript. Nenhum áudio, token, conversa ou arquivo do bot faz parte
deste projeto. Não há dependências de terceiros no navegador.

## Acesso e privacidade

No GitHub Pages comum, a página publicada é pública. Repositório privado
não equivale a site privado. Esta página não tem login nem autenticação.
Publicação pública deve ser autorizada antes de ativar o Pages.

Os áudios permanecem no computador. Cada visitante só pode ler os arquivos
que ele mesmo autorizar no próprio navegador. Receber o link não dá acesso
à galeria de outro computador.

## Utilização

Abra a página em uma aba do Edge ou Chrome, clique em Conectar pasta local
e selecione a pasta `output\audio` do bot para carregar todas as coleções.
Também aceita a raiz `_bot`, a pasta `bordoes_ultron` ou uma coleção individual;
nesses dois últimos casos aparecem somente as coleções dentro da pasta escolhida.
A aplicação
solicita apenas leitura. O navegador pode pedir nova autorização em outra sessão.

Inclui as coleções de personagens e bordões, a expansão PT-BR e os catálogos
de revisão. Estes últimos são identificados como em revisão, sem inferir que
foram aprovados ou ativados no bot. Fontes brutas e históricos de manifestos
não entram na listagem; o diálogo completo Ultron/Visão é uma exceção explícita.

Busca por fala/personagem, filtros por personagem, coleção e duração, favoritos
e reprodução funcionam localmente. A listagem carrega 60 cartões por vez e
remove cópias pelo hash cadastrado. A pasta é relida
a cada cinco segundos com a aba visível e ao retornar para a aba. A política
de conteúdo bloqueia conexões feitas pela aplicação (connect-src 'none').

## Verificação e publicação

A página inclui filtro por idioma, caixa de seleção em cada áudio, marcação
de todos os resultados do filtro e download local da seleção em JSON. Marcar
ou salvar não exclui arquivos. O JSON contém somente os itens escolhidos,
com caminho relativo, identificador e hash para conferência posterior.
As marcações persistem no navegador, inclusive entre páginas da listagem.
O idioma é o registro do catálogo/ASR; ausência de registro não vira português.
O falso positivo Chaves V2-049 foi reconferido com Whisper Medium local e é
exibido como português sem modificar os manifestos do bot.

```
node --test local.test.mjs
node build.mjs
```

Para conferir uma biblioteca real com o mesmo leitor da página:

```
node inspect-gallery.mjs CAMINHO_DA_PASTA_AUDIO
```

Esse comando lê os JSON e metadados dos arquivos, sem copiar os áudios para
o projeto. Testa também uma nova execução e o cache de manifestos.

O build gera dist/index.html, um HTML autônomo. O workflow pages.yml testa,
constrói e publica dist. A publicação depende de habilitar GitHub Pages com
GitHub Actions no repositório. Este projeto não publica o código do bot.
