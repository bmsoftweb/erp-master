import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileKey2, Images, Mail, Monitor, ShieldCheck, Trash2 } from 'lucide-react';
import { CaixasEmpresa } from './CaixasEmpresa';
import { SmtpEmpresa } from './SmtpEmpresa';
import { ImagensPdvEmpresa } from './ImagensPdvEmpresa';
import { Tela, Cartao, Carregando } from './Tela';
import { FormCrm, Campo, INPUT_CLASS, HINT_CLASS } from './FormCrm';
import { Toast } from './AvisoErro';
import { ConfirmDialog } from './ConfirmDialog';
import { abaClasse, abaTexto } from './BarraAbas';
import { gravarCertificado, lerCertificado, removerCertificado, type Certificado } from '../services/api';
import { formatarCnpj } from '../utils/cnpj';
import { formatarDataHora } from '../utils/formato';
import type { Empresa } from '../types';

/**
 * Configurações de uma empresa: abre pela ação "Configurações" da lista de Empresas. Uma aba por assunto.
 * Certificados: o A1 (.pfx) da empresa (sys_empresas_certificados), usado pelo erp-nfe (NF-e/NFC-e) e pelo erp-nfs
 * (NFS-e). Só o Master grava.
 * E-mail (SMTP): o servidor de envio da empresa (sys_empresas_smtp), lido pelo erp-nfe e pelo erp-compras (SmtpEmpresa).
 * Caixas (PDV): os computadores do erp-pdv desta empresa e o token de registro de cada um (CaixasEmpresa).
 * Imagens do caixa e da tela do cliente: vitrines de promoções e datas comemorativas do PDV (ImagensPdvEmpresa).
 */

interface Envio {
  arquivo: File | null;
  senha: string;
}
const ENVIO_VAZIO: Envio = { arquivo: null, senha: '' };

const base64 = (f: File) =>
  new Promise<string>((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(f);
  });

const data = (v: string) => formatarDataHora(v.slice(0, 10));

/** Situação do certificado: verde válido, âmbar vence em até 30 dias, vermelho vencido */
const Situacao: React.FC<{ dias: number }> = ({ dias }) => {
  const [cor, texto] =
    dias < 0
      ? ['bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900', `Vencido há ${-dias} dia${dias === -1 ? '' : 's'}`]
      : dias <= 30
        ? ['bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900', `Vence em ${dias} dia${dias === 1 ? '' : 's'}`]
        : ['bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900', `Válido (${dias} dias)`];
  return <span className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${cor}`}>{texto}</span>;
};

const Linha: React.FC<{ rotulo: string; children: React.ReactNode }> = ({ rotulo, children }) => (
  <div className="flex flex-col py-1">
    <span className="text-[10px] font-semibold uppercase text-stone-400">{rotulo}</span>
    <span className="min-w-0 break-words text-stone-700 dark:text-stone-300">{children}</span>
  </div>
);

const ABAS = [
  ['certificados', ShieldCheck, 'Certificados'],
  ['smtp', Mail, 'E-mail (SMTP)'],
  ['caixas', Monitor, 'Caixas (PDV)'],
  ['imagens', Images, 'Imagens do caixa'],
  ['imagensCliente', Images, 'Imagens da tela do cliente'],
] as const;

export const ConfiguracoesEmpresa: React.FC<{ empresa: Empresa; onVoltar: () => void }> = ({ empresa, onVoltar }) => {
  const [aba, setAba] = useState<(typeof ABAS)[number][0]>('certificados');
  // undefined = carregando; null = sem certificado
  const [certificado, setCertificado] = useState<Certificado | null | undefined>(undefined);
  const [envio, setEnvio] = useState<Envio>(ENVIO_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const seletor = useRef<HTMLInputElement>(null);

  const carregar = () =>
    lerCertificado(empresa.id)
      .then((r) => setCertificado(r.certificado))
      .catch((e: Error) => setErro(e.message));
  useEffect(() => void carregar(), [empresa.id]);

  const limpar = () => {
    setEnvio(ENVIO_VAZIO);
    if (seletor.current) seletor.current.value = '';
  };

  const salvar = async () => {
    if (!envio.arquivo) return setErro('Escolha o arquivo do certificado (.pfx ou .p12).');
    setSalvando(true);
    setErro(null);
    try {
      await gravarCertificado(empresa.id, { arquivo: await base64(envio.arquivo), nome: envio.arquivo.name, senha: envio.senha });
      setToast('Certificado gravado.');
      limpar();
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  // Raiz do CNPJ (8 primeiros): o certificado da matriz vale para as filiais
  const outraRaiz = (c: Certificado) => !!c.cnpj && c.cnpj.slice(0, 8) !== empresa.cnpj.slice(0, 8);
  const c = certificado;

  return (
    <Tela
      titulo="Configurações"
      subtitulo={`Configurações da empresa ${empresa.nome_fantasia || empresa.razao_social}`}
      acoes={
        <button type="button" onClick={onVoltar} title="Volta para a lista de empresas" className="shrink-0 inline-flex items-center gap-1.5 h-[34px] px-3 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800">
          <ArrowLeft className="w-3.5 h-3.5" />
          Empresas
        </button>
      }
    >
      <div className="flex shrink-0 bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800">
        {ABAS.map(([chave, Icone, nome]) => (
          <div key={chave} className={abaClasse(aba === chave) + ' px-4'}>
            <span className={abaTexto(aba === chave)} onClick={() => setAba(chave)}>
              <Icone className="w-3.5 h-3.5" />
              {nome}
            </span>
          </div>
        ))}
      </div>

      {aba === 'imagens' || aba === 'imagensCliente' ? (
        <ImagensPdvEmpresa key={aba} empresaId={empresa.id} tela={aba === 'imagens' ? 'caixa' : 'cliente'} />
      ) : aba === 'smtp' ? (
        <SmtpEmpresa empresaId={empresa.id} />
      ) : aba === 'caixas' ? (
        <CaixasEmpresa empresaId={empresa.id} />
      ) : (
      <FormCrm onSubmit={salvar} onCancel={limpar} saving={salvando} erro={erro} onFecharErro={() => setErro(null)} rodape={`Empresa #${empresa.id} • Certificados`}>
        {c === undefined ? (
          <Carregando />
        ) : (
          <Cartao className="p-4 text-xs">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100">Certificado digital A1</h3>
                <p className={HINT_CLASS}>Usado na emissão de NF-e / NFC-e (erp-nfe) e de NFS-e (erp-nfs).</p>
              </div>
              {c && (
                <div className="flex items-center gap-1.5">
                  <Situacao dias={Number(c.dias)} />
                  <button type="button" onClick={() => setRemovendo(true)} title="Remover o certificado" className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            {c ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6">
                <Linha rotulo="Titular">{c.razao_social || '—'}</Linha>
                <Linha rotulo="CNPJ">
                  {c.cnpj ? formatarCnpj(c.cnpj) : '—'}
                  {outraRaiz(c) && <span className="block text-amber-700 dark:text-amber-400">Raiz diferente do CNPJ da empresa ({formatarCnpj(empresa.cnpj)}).</span>}
                </Linha>
                <Linha rotulo="Validade">
                  <span className="tabular-nums">
                    {data(c.valido_de)} a {data(c.valido_ate)}
                  </span>
                </Linha>
                <Linha rotulo="Emissor">{c.emissor || '—'}</Linha>
                <Linha rotulo="Nº de série">
                  <span className="font-mono">{c.numero_serie || '—'}</span>
                </Linha>
                <Linha rotulo="Gravado em">
                  <span className="tabular-nums">{formatarDataHora(c.atualizado_em)}</span>
                </Linha>
                <Linha rotulo="Arquivo">{c.nome_arquivo}</Linha>
              </div>
            ) : (
              <p className="py-6 text-center text-stone-400">Nenhum certificado gravado. Sem ele, a empresa não emite NF-e, NFC-e nem NFS-e.</p>
            )}
          </Cartao>
        )}
        <h3 className="pt-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{c ? 'Substituir o certificado' : 'Gravar certificado'}</h3>

        <Campo rotulo="Arquivo do certificado" span={2} dica="Arquivo .pfx ou .p12 do certificado A1.">
          <input ref={seletor} type="file" accept=".pfx,.p12" className="hidden" onChange={(e) => setEnvio({ ...envio, arquivo: e.target.files?.[0] ?? null })} />
          <button type="button" data-obrigatorio onClick={() => seletor.current?.click()} className={`campo-botao ${INPUT_CLASS} flex items-center gap-2 text-left cursor-pointer`}>
            <FileKey2 className="w-3.5 h-3.5 shrink-0 text-stone-400" />
            <span className={`truncate ${envio.arquivo ? '' : 'text-stone-400 font-normal'}`}>{envio.arquivo?.name ?? 'Escolher arquivo…'}</span>
          </button>
        </Campo>
        <Campo rotulo="Senha do certificado" span={2} dica="Conferida com o arquivo antes de gravar; não volta para a tela.">
          <input type="password" required autoComplete="new-password" value={envio.senha} onChange={(e) => setEnvio({ ...envio, senha: e.target.value })} className={INPUT_CLASS} />
        </Campo>
      </FormCrm>
      )}

      {removendo && (
        <ConfirmDialog
          titulo="Remover certificado?"
          mensagem="O certificado será apagado desta empresa. Sem ele, a emissão de NF-e, NFC-e e NFS-e para até um novo ser gravado."
          confirmar="Remover"
          onConfirmar={async () => {
            await removerCertificado(empresa.id);
            setRemovendo(false);
            setToast('Certificado removido.');
            carregar();
          }}
          onCancelar={() => setRemovendo(false)}
        />
      )}
      {toast && <Toast mensagem={toast} onFechar={() => setToast(null)} />}
    </Tela>
  );
};
