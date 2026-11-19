import React, { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { Tela, Carregando } from './Tela';
import { FormCrm, Campo, INPUT_CLASS, HINT_CLASS } from './FormCrm';
import { Toast } from './AvisoErro';
import { abaClasse, abaTexto } from './BarraAbas';
import { lerConfigGrupo, listar, salvarConfigGrupo } from '../services/api';
import type { Grupo } from '../types';

/**
 * Configurações dos módulos por grupo (sys_grupos.config, JSON com uma chave por módulo).
 * Uma aba por módulo; módulo novo = aba aqui + validação em CONFIG_MODULOS (server/app.ts).
 * Super escolhe o grupo; o admin só vê o dele.
 */

interface ConfigEstoque {
  imagens_fonte: 'google' | 'serper';
  serper_api_key: string;
}

const ABAS = [{ id: 'estoque', titulo: 'Estoque', Icone: Package }] as const;
type Aba = (typeof ABAS)[number]['id'];

const doEstoque = (c: any): ConfigEstoque => ({ imagens_fonte: c?.imagens_fonte === 'serper' ? 'serper' : 'google', serper_api_key: c?.serper_api_key || '' });

export const Configuracoes: React.FC = () => {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [grupoId, setGrupoId] = useState<number | null>(null);
  const [aba, setAba] = useState<Aba>('estoque');
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [estoque, setEstoque] = useState<ConfigEstoque>(doEstoque(null));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    listar<Grupo>('grupos')
      .then((g) => {
        const ativos = g.filter((x) => x.ativo);
        setGrupos(ativos);
        if (ativos.length) setGrupoId(ativos[0].id);
      })
      .catch((e) => setErro(e.message));
  }, []);

  const carregar = (id: number) => {
    setConfig(null);
    lerConfigGrupo(id)
      .then((c) => {
        setConfig(c);
        setEstoque(doEstoque(c.estoque));
      })
      .catch((e) => setErro(e.message));
  };
  useEffect(() => {
    if (grupoId !== null) carregar(grupoId);
  }, [grupoId]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (grupoId === null) return;
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

  const nomeGrupo = grupos?.find((g) => g.id === grupoId)?.nome;

  return (
    <Tela
      titulo="Configurações"
      subtitulo={nomeGrupo ? `Configurações dos módulos do grupo ${nomeGrupo}` : 'Configurações dos módulos por grupo'}
      acoes={
        grupos && grupos.length > 1 ? (
          <select value={grupoId ?? ''} onChange={(e) => setGrupoId(Number(e.target.value))} className={INPUT_CLASS + ' !w-auto'} title="Grupo">
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      <div className="flex shrink-0 bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800">
        {ABAS.map(({ id, titulo, Icone }) => (
          <div key={id} className={abaClasse(aba === id) + ' px-4'}>
            <button type="button" onClick={() => setAba(id)} className={abaTexto(aba === id)}>
              <Icone className="w-3.5 h-3.5" />
              {titulo}
            </button>
          </div>
        ))}
      </div>

      {!grupos || (grupoId !== null && !config) ? (
        <Carregando />
      ) : grupoId === null ? (
        <p className="p-8 text-center text-xs text-stone-400">Nenhum grupo ativo.</p>
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
