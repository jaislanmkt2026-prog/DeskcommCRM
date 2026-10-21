---
impacto: nada_mudou
secao: corrigido
titulo: Atualização volta banco e aplicação juntos quando algo falha
---

Se uma atualização falhar depois de alterar o banco, o kit restaura o dump da própria rodada, o código e a configuração anterior antes de religar o CRM. Se a restauração não terminar, a instalação permanece em manutenção para não operar com banco e aplicação desencontrados.
