import React, { useState } from 'react';
import { Plug } from 'lucide-react';
import { CadastroCrm } from './CadastroCrm';
import { Campo, INPUT_CLASS } from './FormCrm';
import { AvisoErro, Toast } from './AvisoErro';
import { Toggle } from './Toggle';
import { excluirSmtp, listarSmtp, salvarSmtp, testarSmtp, type ContaSmtp, type FormSmtp } from '../services/api';
import { FINALIDADES_SMTP } from '../utils/listas';
import { formatarDataHora, simNao } from '../utils/formato';

/**
 * Aba "E-mail (SMTP)" das Configurações da empresa: as contas de envio da empresa (sys_empresas_smtp), uma por
 * finalidade. Cada módulo usa a conta da sua finalidade e, sem ela, a Padrão: o erp-nfe manda o XML/DANFE (inclusive
 * os do erp-pdv) e o erp-compras, as cotações. As respostas vão para "Responder para" ou, em branco, para o remetente.
 */

const selecionar = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

export const SmtpEmpresa: React.FC<{ empresaId: number }> = ({ empresaId }) => {
  const [usadas, setUsadas] = useState<string[]>([]);
  const [testando, setTestando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const testar = async (f: FormSmtp, conta: ContaSmtp | null) => {
    if (!f.host.trim()) return setErro('Informe o servidor SMTP.');
    setTestando(true);
    setErro(null);
    try {
      await testarSmtp(empresaId, { ...f, id: conta?.id });
      setToast('Conexão com o servidor SMTP funcionando.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setTestando(false);
    }
  };

  return (
    <>
      <CadastroCrm<ContaSmtp, FormSmtp>
        key={empresaId}
        cadastro="empresa_smtp"
        embutido
        titulo="E-mail (SMTP)"
        subtitulo=""
        registro="Conta de e-mail"
        feminino
        fonte={{
          listar: () => listarSmtp(empresaId),
          salvar: (id, f) => salvarSmtp(empresaId, id, f),
          excluir: (id) => excluirSmtp(empresaId, id),
        }}
        aoCarregar={(linhas) => setUsadas(linhas.map((l) => l.finalidade))}
        nomeDe={(c) => `${FINALIDADES_SMTP[c.finalidade] ?? c.finalidade} (${c.usuario || c.host})`}
        colunas={[
          { key: 'finalidade', label: 'Finalidade', largura: 190, render: (c) => FINALIDADES_SMTP[c.finalidade] ?? c.finalidade },
          { key: 'host', label: 'Servidor', largura: 180 },
          { key: 'porta', label: 'Porta', alinhar: 'numero', largura: 70 },
          { key: 'usuario', label: 'Usuário', largura: 200 },
          { key: 'remetente', label: 'Remetente', largura: 220 },
          { key: 'responder_para', label: 'Responder para', largura: 200 },
          { key: 'usa_ssl', label: 'SSL', alinhar: 'centro', largura: 60, render: (c) => simNao(c.usa_ssl) },
          { key: 'atualizado_em', label: 'Alterada em', alinhar: 'centro', largura: 130, render: (c) => formatarDataHora(c.atualizado_em) },
        ]}
        novo={() => ({
          finalidade: Object.keys(FINALIDADES_SMTP).find((k) => !usadas.includes(k)) ?? 'padrao',
          host: '',
          porta: '587',
          usuario: '',
          senha: '',
          remetente: '',
          responder_para: '',
          usa_ssl: false,
          usa_tls: true,
        })}
        doRegistro={(c) => ({
          finalidade: c.finalidade,
          host: c.host,
          porta: String(c.porta),
          usuario: c.usuario ?? '',
          senha: '',
          remetente: c.remetente ?? '',
          responder_para: c.responder_para ?? '',
          usa_ssl: !!c.usa_ssl,
          usa_tls: !!c.usa_tls,
        })}
        campos={(f, alterar, editando) => (
          <>
            <Campo rotulo="Finalidade" span={2} dica="O módulo usa a conta da sua finalidade; sem ela, a Padrão.">
              <select value={f.finalidade} onChange={(e) => alterar({ finalidade: e.target.value })} className={INPUT_CLASS}>
                {Object.entries(FINALIDADES_SMTP).map(([k, nome]) => (
                  <option key={k} value={k} disabled={k !== editando?.finalidade && usadas.includes(k)}>
                    {nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Servidor SMTP" span={2}>
              <input required autoFocus maxLength={255} value={f.host} onChange={(e) => alterar({ host: e.target.value })} onFocus={selecionar} placeholder="smtp.provedor.com.br" className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo="Porta" dica="Em branco: 465 com SSL, 587 sem.">
              <input value={f.porta} onChange={(e) => alterar({ porta: e.target.value.replace(/\D/g, '').slice(0, 5) })} onFocus={selecionar} inputMode="numeric" className={`${INPUT_CLASS} text-right tabular-nums`} />
            </Campo>
            <Campo rotulo="Segurança">
              <div className="flex flex-col gap-1.5 py-1">
                <Toggle size="sm" checked={f.usa_ssl} onChange={(v) => alterar({ usa_ssl: v, porta: v ? '465' : '587' })} label="SSL (porta 465)" />
                <Toggle size="sm" checked={f.usa_tls} onChange={(v) => alterar({ usa_tls: v })} label="Exigir STARTTLS" />
              </div>
            </Campo>
            <Campo rotulo="Usuário" span={2}>
              <input maxLength={255} autoComplete="off" value={f.usuario} onChange={(e) => alterar({ usuario: e.target.value })} onFocus={selecionar} className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo="Senha" span={2} dica="Não volta para a tela. Em branco mantém a gravada.">
              <input type="password" maxLength={255} autoComplete="new-password" value={f.senha} onChange={(e) => alterar({ senha: e.target.value })} placeholder={editando?.tem_senha ? '•••••• (gravada)' : ''} className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo="Remetente" span={2} dica='Endereço que aparece no "De". Em branco: o usuário.'>
              <input maxLength={255} value={f.remetente} onChange={(e) => alterar({ remetente: e.target.value })} onFocus={selecionar} placeholder="Empresa <compras@empresa.com.br>" className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo="Responder para" span={2} dica="Endereço que recebe as respostas. Em branco: o remetente.">
              <input maxLength={255} value={f.responder_para} onChange={(e) => alterar({ responder_para: e.target.value })} onFocus={selecionar} className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo="Conexão" span={2}>
              <button
                type="button"
                onClick={() => testar(f, editando)}
                disabled={testando}
                title="Testar conexão"
                data-dica-desc="Conecta e autentica com os dados da tela, sem enviar e-mail"
                className="inline-flex items-center gap-1.5 h-[34px] px-3 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plug className="w-3.5 h-3.5" />
                {testando ? 'Testando…' : 'Testar conexão'}
              </button>
            </Campo>
          </>
        )}
      />
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {toast && <Toast mensagem={toast} onFechar={() => setToast(null)} />}
    </>
  );
};
