import React, { useEffect, useState } from 'react';
import { Tela, Carregando } from './Tela';
import { FormCrm, Campo, INPUT_CLASS } from './FormCrm';
import { AvisoErro, Toast } from './AvisoErro';
import { gravarDesenvolvedor, lerDesenvolvedor, type Desenvolvedor as Dados } from '../services/api';
import { cnpjValido, formatarCnpj, limparCnpj } from '../utils/cnpj';
import { formatarDataHora, formatarTelefone, limparDigitos } from '../utils/formato';

/**
 * Empresa desenvolvedora e arquitetura do PAF-NFC-e (sys_paf, uma linha para todo o ERP). O erp-pdv lê dali a
 * identificação do Menu Fiscal, o registro U2 do Arquivo I e o arqBD/arqSist do XML; erp-pdv e erp-vendas leem a versão
 * do PAF (PAF único) para o verProc das notas. Só o super.
 */

const VAZIO: Dados = {
  desenvolvedor_razao: '',
  desenvolvedor_cnpj: '',
  desenvolvedor_ie: '',
  desenvolvedor_im: '',
  desenvolvedor_endereco: '',
  desenvolvedor_telefone: '',
  desenvolvedor_responsavel: '',
  arq_bd: '',
  arq_sist: '',
  versao: '',
};

export const Desenvolvedor: React.FC = () => {
  // null = carregando
  const [gravado, setGravado] = useState<Dados | null>(null);
  const [f, setF] = useState<Dados>(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const carregar = () =>
    lerDesenvolvedor()
      .then((r) => {
        const d = { ...VAZIO, ...r.desenvolvedor };
        setGravado(d);
        setF(d);
      })
      .catch((e: Error) => setErro(e.message));
  useEffect(() => void carregar(), []);

  const alterar = (p: Partial<Dados>) => setF({ ...f, ...p });
  const texto = (k: keyof Dados, max: number, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input maxLength={max} value={f[k] ?? ''} onChange={(e) => alterar({ [k]: e.target.value })} className={INPUT_CLASS} {...extra} />
  );

  const salvar = async () => {
    if (!cnpjValido(f.desenvolvedor_cnpj)) return setErro('CNPJ inválido: confira os dígitos.');
    setSalvando(true);
    setErro(null);
    try {
      await gravarDesenvolvedor(f);
      setToast('Dados do desenvolvedor gravados.');
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Tela titulo="Desenvolvedor" subtitulo="Empresa desenvolvedora e arquitetura do PAF-NFC-e (vale para todo o ERP)">
      {!gravado ? (
        <Carregando />
      ) : (
        <FormCrm
          onSubmit={salvar}
          onCancel={() => setF(gravado)}
          saving={salvando}
          erro={erro}
          onFecharErro={() => setErro(null)}
          rodape={gravado.atualizado_em ? `Alterado em ${formatarDataHora(gravado.atualizado_em)}` : 'Desenvolvedor do PAF-NFC-e'}
        >
          <Campo rotulo="Razão social" span={2} dica="Vai no registro U2 do Arquivo I (até 50 caracteres).">
            {texto('desenvolvedor_razao', 50, { required: true })}
          </Campo>
          <Campo rotulo="CNPJ">
            <input required value={formatarCnpj(f.desenvolvedor_cnpj)} onChange={(e) => alterar({ desenvolvedor_cnpj: limparCnpj(e.target.value) })} placeholder="00.000.000/0000-00" className={`${INPUT_CLASS} tabular-nums`} />
          </Campo>
          <Campo rotulo="Telefone">
            <input value={formatarTelefone(f.desenvolvedor_telefone)} onChange={(e) => alterar({ desenvolvedor_telefone: limparDigitos(e.target.value, 11) })} placeholder="(00) 00000-0000" inputMode="tel" className={`${INPUT_CLASS} tabular-nums`} />
          </Campo>
          <Campo rotulo="Inscrição estadual" dica="Só dígitos.">
            <input value={f.desenvolvedor_ie} onChange={(e) => alterar({ desenvolvedor_ie: limparDigitos(e.target.value, 14) })} inputMode="numeric" className={`${INPUT_CLASS} tabular-nums`} />
          </Campo>
          <Campo rotulo="Inscrição municipal" dica="Só dígitos.">
            <input value={f.desenvolvedor_im} onChange={(e) => alterar({ desenvolvedor_im: limparDigitos(e.target.value, 14) })} inputMode="numeric" className={`${INPUT_CLASS} tabular-nums`} />
          </Campo>
          <Campo rotulo="Responsável técnico" span={2}>
            {texto('desenvolvedor_responsavel', 60)}
          </Campo>
          <Campo rotulo="Endereço" span={3}>
            {texto('desenvolvedor_endereco', 150)}
          </Campo>
          <Campo rotulo="Versão do PAF-NFC-e" dica="Uma só para o erp-pdv e o erp-vendas: vai no verProc das notas e na identificação do Menu Fiscal. Atualizar a cada versão publicada.">
            {texto('versao', 10, { required: true, placeholder: '0.1.6' })}
          </Campo>
          <Campo rotulo="Arquitetura do banco de dados" span={2} dica="Requisito VI, I, c: com o provedor quando na nuvem.">
            {texto('arq_bd', 120, { required: true })}
          </Campo>
          <Campo rotulo="Arquitetura do sistema" span={2} dica="Requisito VI, I, d: com o provedor quando na nuvem.">
            {texto('arq_sist', 120, { required: true })}
          </Campo>
        </FormCrm>
      )}
      {!gravado && erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {toast && <Toast mensagem={toast} onFechar={() => setToast(null)} />}
    </Tela>
  );
};
