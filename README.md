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
e selecione a pasta ultron que contém manifesto.json e os áudios. A aplicação
solicita apenas leitura. O navegador pode pedir nova autorização em outra sessão.

Busca, filtros, favoritos e reprodução funcionam localmente. A pasta é relida
a cada cinco segundos com a aba visível e ao retornar para a aba. A política
de conteúdo bloqueia conexões feitas pela aplicação (connect-src 'none').

## Verificação e publicação

```
node --test local.test.mjs
node build.mjs
```

O build gera dist/index.html, um HTML autônomo. O workflow pages.yml testa,
constrói e publica dist. A publicação depende de habilitar GitHub Pages com
GitHub Actions no repositório. Este projeto não publica o código do bot.
