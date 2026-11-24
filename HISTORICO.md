# Histórico de versões

Mais recente primeiro. PATCH a cada envio ao GitHub; MAJOR/MINOR só quando pedido.

## 0.1.8 — 2026-11-24

- Configurações da empresa: aba "E-mail (SMTP)" com as contas de envio da empresa (`sys_empresas_smtp`), uma por finalidade (Padrão, NF-e, Compras, CRM comercial, CRM suporte), "Responder para" e "Testar conexão". O erp-nfe, o erp-compras e o erp-crm passam a ler dali.

## 0.1.7 — 2026-11-23

- Marca BM na tela: título da aba, login, menu e log do servidor voltam a "BM-Master".

## 0.1.6 — 2026-11-23

- Nome "ERP-Master" no lugar de "BM-Master" (título, pacote, telas).
- Desenvolvedor: campo "Versão do PAF-NFC-e" (`sys_paf.versao`).
- Usuários: toggle e coluna "Usuário de balcão" (`sys_usuarios.balcao`).
- Logo BMsoft centralizado no cabeçalho para o nível usuário.
- Pesquisas: aba "Fornecedores" (usada pelo erp-compras).

## 0.1.5 — 2026-11-21

- Configurações da empresa ganham abas: Caixas (PDV), com token de registro de cada computador, teclado virtual, TEF SiTEF e balança (velocidade e formato) por caixa; Imagens do caixa e Imagens da tela do cliente, vitrines do erp-pdv.

## 0.1.4 — 2026-11-20

- Configurações do grupo saem do menu e abrem pela ação "Configurações" da lista de Grupos.
- Nova aba Pesquisas (só super) nas Configurações do grupo: campos extras das pesquisas do erp-vendas, criar/voltar ao padrão os campos do sistema e SQL próprio da pesquisa ("Ver SQL", testado antes de gravar, e aba "Raw" com o SQL final).
- Empresas: nova ação "Configurações" com a aba Certificados — o A1 (.pfx) da empresa, com a senha conferida antes de gravar, em `sys_empresas_certificados` (lido pelo erp-nfe e pelo erp-nfs). Cópia dos certificados antigos em `extras/2026-11-19_certificados_sys_empresas.sql`.
- Novo cadastro Desenvolvedor (só super): empresa desenvolvedora e arquitetura do PAF-NFC-e em `sys_paf`, lidas pelo erp-pdv.
- Campos: no foco, moldura de 2px na cor da barra; selects com a lista arredondada e a seta em chevron.
- Banco: conexões paradas são fechadas antes de serem reaproveitadas (evita ECONNRESET).

## 0.1.3 — 2026-11-19

- Dicas (tooltips) no padrão BMsoft em todo o app: caixa escura com seta no lugar da dica nativa do navegador.
- Nova tela Configurações (só administrador) com a configuração dos módulos por grupo; aba Estoque com a fonte das imagens (Google ou Serper e chave da API).

## 0.1.2 — 2026-11-11

Ajustes gerais.

- Corrigido: editar o grupo ou a empresa de código 0 (demonstração) incluía um registro novo em vez de alterar.
- Usuários: abrir um usuário para editar antes de as empresas carregarem não apaga mais as empresas liberadas dele ao gravar.
- Usuários e Empresas: falha ao carregar grupos, empresas ou perfis do formulário mostra o aviso de erro (antes as listas ficavam vazias sem explicação).
- Inativar grupo/empresa e excluir perfil inexistente responde "não encontrado".
- Logo do login igual ao do menu e da aba; aba de módulo sem fundo branco no modo escuro.
- Removidas dependências sem uso (`@google/genai`, `@hookform/resolvers`, `jsonwebtoken`, `firebase-tools`).

## 0.1.1 — 2026-11-11

Primeiro envio ao GitHub.

- Projeto no modelo do crmWeb (Vite + React + Express), no mesmo banco do bm-estoque (tabelas `sys_*`); login pelo `sys_usuarios`.
- Cadastros no padrão do bm-estoque (lista com busca, colunas configuráveis e formulário em grade): Grupos, Usuários, Perfis e Módulos. Empresas abre pela ação "Empresas" da lista de Grupos, sempre filtrada pelo grupo.
- Usuário com grupo (`sys_usuarios.grupo_id`, `extras/2026-11-10_usuarios_grupo.sql`); empresa principal e empresas liberadas só do grupo dele.
- Níveis (`sys_usuarios.nivel`): super vê tudo; admin só o próprio grupo, vê grupo e empresas sem alterar e cadastra os usuários do grupo; user só vê os Módulos, sem o menu.
- Módulos abrem em abas do próprio Master, com entrada automática (sem login): clicar num módulo já aberto só ativa a aba, Sair fecha todas, ↗ abre o módulo numa aba do navegador. O módulo abre no mesmo modo claro/escuro do Master; erro na entrada fecha a aba e mostra o aviso; Sair dentro do módulo fecha a aba dele.
- Cada app com ícone e cor próprios no logo, no card de Módulos e na aba; cards de Módulos menores, 5 por linha.
