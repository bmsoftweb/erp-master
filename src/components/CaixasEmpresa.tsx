import React, { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { CadastroCrm } from './CadastroCrm';
import { Campo, INPUT_CLASS } from './FormCrm';
import { AvisoErro, Toast } from './AvisoErro';
import { ConfirmDialog } from './ConfirmDialog';
import { BotaoAcao } from './MenuAcoes';
import { Toggle } from './Toggle';
import { inativarCaixa, listarCaixas, salvarCaixa, usuariosDosCaixas, type CaixaPdv } from '../services/api';
import { formatarDataHora, simNao } from '../utils/formato';

/**
 * Aba "Caixas (PDV)" das Configurações da empresa: um caixa por computador do erp-pdv (pdv_caixas). O token é digitado
 * uma vez no login do PDV daquele computador ("Registrar"); daí em diante ele só entra nesta empresa e, com usuário
 * escolhido, só com esse usuário (que também só entra por ele). Excluir inativa o caixa.
 */

interface Form {
  descricao: string;
  usuario_id: number | null;
  ativo: boolean;
  /** Só na edição */
  token?: string;
  novo_token: boolean;
  sitef_ip: string;
  sitef_loja: string;
  sitef_terminal: string;
  teclado_virtual: boolean;
  balanca: boolean;
  balanca_velocidade: number;
  balanca_formato: string;
}

export const CaixasEmpresa: React.FC<{ empresaId: number }> = ({ empresaId }) => {
  const [usuarios, setUsuarios] = useState<{ id: number; login: string }[]>([]);
  // "Gerar novo": confirma antes de marcar o formulário
  const [trocarToken, setTrocarToken] = useState<(() => void) | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    usuariosDosCaixas(empresaId)
      .then(setUsuarios)
      .catch((e: Error) => setErro(e.message));
  }, [empresaId]);

  const copiar = (token: string) =>
    navigator.clipboard.writeText(token).then(
      () => setToast(`Token ${token} copiado.`),
      () => setErro('Não foi possível copiar o token.'),
    );

  return (
    <>
      <CadastroCrm<CaixaPdv, Form>
        key={empresaId}
        cadastro="empresa_caixas"
        embutido
        titulo="Caixas (PDV)"
        subtitulo=""
        registro="Caixa"
        inativa
        fonte={{
          listar: () => listarCaixas(empresaId),
          salvar: (id, f) => salvarCaixa(empresaId, id, f),
          excluir: (id) => inativarCaixa(empresaId, id),
        }}
        nomeDe={(c) => `Caixa ${c.numero} (${c.descricao})`}
        acoesExtras={(c) => <BotaoAcao icone={Copy} titulo="Copiar token" descricao="Copia o token para digitar no computador do caixa" onClick={() => copiar(c.token)} />}
        colunas={[
          { key: 'numero', label: 'Nº', alinhar: 'numero', largura: 60 },
          { key: 'descricao', label: 'Descrição', largura: 200 },
          { key: 'login', label: 'Usuário', largura: 180, render: (c) => c.login ?? 'Qualquer' },
          { key: 'token', label: 'Token', largura: 110, render: (c) => <span className="font-mono">{c.token}</span> },
          { key: 'registrado_em', label: 'Registrado em', alinhar: 'centro', largura: 130, render: (c) => formatarDataHora(c.registrado_em) },
          { key: 'ultimo_acesso', label: 'Último acesso', alinhar: 'centro', largura: 130, render: (c) => formatarDataHora(c.ultimo_acesso) },
          { key: 'ultimo_login', label: 'Último usuário', largura: 180 },
          { key: 'ultimo_ip', label: 'Último IP', largura: 120 },
          { key: 'sitef_terminal', label: 'TEF', largura: 110, render: (c) => (c.sitef_terminal ? `SiTEF ${c.sitef_terminal}` : 'À mão') },
          { key: 'teclado_virtual', label: 'Teclado virtual', alinhar: 'centro', largura: 110, render: (c) => simNao(c.teclado_virtual) },
          { key: 'balanca', label: 'Balança', alinhar: 'centro', largura: 110, render: (c) => (Number(c.balanca) === 1 ? `${c.balanca_velocidade} ${c.balanca_formato}` : 'Não') },
          { key: 'ativo', label: 'Ativo', alinhar: 'centro', largura: 70, render: (c) => simNao(c.ativo) },
        ]}
        novo={() => ({ descricao: '', usuario_id: null, ativo: true, novo_token: false, sitef_ip: '', sitef_loja: '', sitef_terminal: '', teclado_virtual: false, balanca: false, balanca_velocidade: 2400, balanca_formato: '8N1' })}
        doRegistro={(c) => ({ descricao: c.descricao, usuario_id: c.usuario_id, ativo: !!c.ativo, token: c.token, novo_token: false, sitef_ip: c.sitef_ip ?? '', sitef_loja: c.sitef_loja ?? '', sitef_terminal: c.sitef_terminal ?? '', teclado_virtual: !!c.teclado_virtual, balanca: Number(c.balanca) === 1, balanca_velocidade: Number(c.balanca_velocidade) || 2400, balanca_formato: c.balanca_formato || '8N1' })}
        campos={(f, alterar, editando) => (
          <>
            <Campo rotulo="Descrição" span={2} dica="Ex.: Caixa da frente, Caixa 2 do balcão.">
              <input autoFocus required maxLength={60} value={f.descricao} onChange={(e) => alterar({ descricao: e.target.value })} onFocus={(e) => e.target.select()} className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo="Usuário" span={2} dica="Escolhido, o computador só aceita este usuário, e ele só entra pelo computador deste caixa.">
              <select value={f.usuario_id ?? ''} onChange={(e) => alterar({ usuario_id: e.target.value === '' ? null : Number(e.target.value) })} className={INPUT_CLASS}>
                <option value="">Qualquer usuário liberado na empresa</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.login}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Servidor SiTEF" span={2} dica="IP ou nome do servidor SiTEF (vários separados por ;). Com servidor, loja e terminal, o PDV passa cartão e PIX pelo TEF (Agente CliSiTef no computador do caixa); vazios, o cartão é lançado à mão.">
              <input maxLength={100} value={f.sitef_ip} onChange={(e) => alterar({ sitef_ip: e.target.value })} onFocus={(e) => e.target.select()} className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo="Loja SiTEF" dica="Código da loja no SiTEF (8 caracteres), passado pela Software Express.">
              <input maxLength={8} value={f.sitef_loja} onChange={(e) => alterar({ sitef_loja: e.target.value.toUpperCase() })} onFocus={(e) => e.target.select()} className={`${INPUT_CLASS} font-mono`} />
            </Campo>
            <Campo rotulo="Terminal SiTEF" dica="Código do terminal deste caixa no SiTEF (8 caracteres, ex.: SE000001).">
              <input maxLength={8} value={f.sitef_terminal} onChange={(e) => alterar({ sitef_terminal: e.target.value.toUpperCase() })} onFocus={(e) => e.target.select()} className={`${INPUT_CLASS} font-mono`} />
            </Campo>
            <Campo rotulo="Teclado virtual" span={2} dica="Para computador com tela touch, sem teclado físico: o PDV abre com o teclado na tela (login inclusive).">
              <div className="h-[34px] flex items-center">
                <Toggle checked={f.teclado_virtual} onChange={(v) => alterar({ teclado_virtual: v })} />
              </div>
            </Campo>
            <Campo rotulo="Balança" dica="Balança de checkout ligada na porta serial ou USB do computador do caixa: o PDV lê o peso dos produtos vendidos por kg. A porta é escolhida no próprio caixa (Mais → Configurar balança), no Chrome ou Edge.">
              <div className="h-[34px] flex items-center">
                <Toggle checked={f.balanca} onChange={(v) => alterar({ balanca: v })} />
              </div>
            </Campo>
            <Campo rotulo="Velocidade" dica="Velocidade da porta da balança (bps), como no manual ou na configuração da balança.">
              <select disabled={!f.balanca} value={f.balanca_velocidade} onChange={(e) => alterar({ balanca_velocidade: Number(e.target.value) })} className={INPUT_CLASS}>
                {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Formato" span={2} dica="Bits de dados, paridade e bits de parada da porta da balança (o mais comum é 8N1; algumas usam 7E1).">
              <select disabled={!f.balanca} value={f.balanca_formato} onChange={(e) => alterar({ balanca_formato: e.target.value })} className={INPUT_CLASS}>
                {['8N1', '8E1', '8O1', '7E1', '7O1', '7N1', '8N2', '7E2'].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Campo>
            {editando && (
              <>
                <Campo rotulo="Token" span={2} dica="Vale para um computador só: digitado uma vez no login do PDV (Registrar). Para outro computador, gere um novo.">
                  <div className="h-[34px] flex items-center gap-2">
                    <span className="font-mono text-sm font-bold tracking-widest text-stone-800 dark:text-stone-100">{f.novo_token ? '(novo ao salvar)' : f.token}</span>
                    {!f.novo_token && (
                      <button
                        type="button"
                        onClick={() => setTrocarToken(() => () => alterar({ novo_token: true }))}
                        title="Gerar novo token"
                        data-dica-desc="O computador registrado com o token atual deixa de entrar até ser registrado de novo"
                        className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Gerar novo
                      </button>
                    )}
                  </div>
                </Campo>
                <Campo rotulo="Ativo" dica="Inativo, o computador deste caixa deixa de entrar no PDV.">
                  <div className="h-[34px] flex items-center">
                    <Toggle checked={f.ativo} onChange={(v) => alterar({ ativo: v })} />
                  </div>
                </Campo>
              </>
            )}
          </>
        )}
      />
      {trocarToken && (
        <ConfirmDialog
          titulo="Gerar novo token?"
          mensagem="Ao salvar, o computador registrado com o token atual deixa de entrar no PDV até ser registrado de novo com o token novo."
          confirmar="Gerar novo"
          onConfirmar={() => {
            trocarToken();
            setTrocarToken(null);
          }}
          onCancelar={() => setTrocarToken(null)}
        />
      )}
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {toast && <Toast mensagem={toast} onFechar={() => setToast(null)} />}
    </>
  );
};
