import React, { useEffect, useState } from 'react';
import { ArrowLeft, Package, Search } from 'lucide-react';
import { Tela, Carregando } from './Tela';
import { FormCrm, Campo, INPUT_CLASS, HINT_CLASS } from './FormCrm';
import { Toast } from './AvisoErro';
import { abaClasse, abaTexto } from './BarraAbas';
import { lerConfigGrupo, salvarConfigGrupo } from '../services/api';
import { PesquisaCampos } from './PesquisaCampos';
import { ehSuper } from '../utils/menu';
import type { Grupo, Usuario } from '../types';

/**
 * Configurações dos módulos de um grupo (sys_grupos.config, JSON com uma chave por módulo): abre pela ação
 * "Configurações" da lista de Grupos, como Empresas (o admin só vê o próprio grupo).
 * Uma aba por módulo; módulo novo = aba aqui + validação em CONFIG_MODULOS (server/app.ts).
 * A aba Pesquisas (campos das pesquisas do erp-vendas) é só do super.
 */

interface ConfigEstoque {
  imagens_fonte: 'google' | 'serper';
  serper_api_key: string;
}

const ABAS = [
  { id: 'estoque', titulo: 'Estoque', Icone: Package, soSuper: false },
  { id: 'pesquisas', titulo: 'Pesquisas', Icone: Search, soSuper: true },
] as const;
type Aba = (typeof ABAS)[number]['id'];

const doEstoque = (c: any): ConfigEstoque => ({ imagens_fonte: c?.imagens_fonte === 'serper' ? 'serper' : 'google', serper_api_key: c?.serper_api_key || '' });

export const Configuracoes: React.FC<{ usuario: Usuario; grupo: Grupo; onVoltar: () => void }> = ({ usuario, grupo, onVoltar }) => {
  const grupoId = grupo.id;
  const [aba, setAba] = useState<Aba>('estoque');
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [estoque, setEstoque] = useState<ConfigEstoque>(doEstoque(null));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const carregar = (id: number) => {
    setConfig(null);
    lerConfigGrupo(id)
      .then((c) => {
        setConfig(c);
        setEstoque(doEstoque(c.estoque));
      })
      .catch((e) => setErro(e.message));
  };
  useEffect(() => carregar(grupoId), [grupoId]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await salvarConfigGrupo(grupoId, aba, estoque);
      setToast('Configurações salvas.');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Tela
      titulo="Configurações"
      subtitulo={`Configurações dos módulos do grupo ${grupo.nome}`}
      acoes={
        <button type="button" onClick={onVoltar} title="Volta para a lista de grupos" className="shrink-0 inline-flex items-center gap-1.5 h-[34px] px-3 rounded-md text-xs font-medium text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800">
          <ArrowLeft className="w-3.5 h-3.5" />
          Grupos
        </button>
      }
    >
      <div className="flex shrink-0 bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800">
        {ABAS.filter((a) => !a.soSuper || ehSuper(usuario)).map(({ id, titulo, Icone }) => (
          <div key={id} className={abaClasse(aba === id) + ' px-4'}>
            <button type="button" onClick={() => setAba(id)} className={abaTexto(aba === id)}>
              <Icone className="w-3.5 h-3.5" />
              {titulo}
            </button>
          </div>
        ))}
      </div>

      {aba === 'pesquisas' ? (
        <PesquisaCampos grupoId={grupoId} />
      ) : !config ? (
        <Carregando />
      ) : (
        aba === 'estoque' && (
          <FormCrm
            onSubmit={salvar}
            onCancel={() => carregar(grupoId)}
            saving={salvando}
            erro={erro}
            onFecharErro={() => setErro(null)}
            rodape={`Grupo #${grupoId} • Estoque`}
          >
            <Campo
              rotulo="Fonte das imagens de produto"
              span={2}
              dica={
                estoque.imagens_fonte === 'google'
                  ? 'Sem custo: "Buscar na internet" abre o Google Imagens numa aba; copie a imagem ou o link e cole (Ctrl+V) na tela de imagens.'
                  : 'Os resultados aparecem dentro do estoque e um clique adiciona a foto. Cada busca gasta uma consulta do Serper (serper.dev).'
              }
            >
              <select value={estoque.imagens_fonte} onChange={(e) => setEstoque({ ...estoque, imagens_fonte: e.target.value as ConfigEstoque['imagens_fonte'] })} className={INPUT_CLASS}>
                <option value="google">Google Imagens (sem custo)</option>
                <option value="serper">Serper (pago por consulta)</option>
              </select>
            </Campo>
            {estoque.imagens_fonte === 'serper' && (
              <Campo rotulo="Chave da API Serper" span={2}>
                <input
                  required
                  maxLength={100}
                  autoComplete="off"
                  spellCheck={false}
                  value={estoque.serper_api_key}
                  onChange={(e) => setEstoque({ ...estoque, serper_api_key: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  className={INPUT_CLASS + ' font-mono'}
                />
              </Campo>
            )}
            {estoque.imagens_fonte === 'google' && estoque.serper_api_key && (
              <p className={HINT_CLASS + ' col-span-full'}>A chave do Serper continua guardada para quando voltar a usá-lo.</p>
            )}
          </FormCrm>
        )
      )}
      {toast && <Toast mensagem={toast} onFechar={() => setToast(null)} />}
    </Tela>
  );
};
