import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { CadastroCrm } from './CadastroCrm';
import { Campo, INPUT_CLASS } from './FormCrm';
import { AvisoErro } from './AvisoErro';
import { DateField } from './DateField';
import { Toggle } from './Toggle';
import { excluirImagemPdv, lerImagemPdv, listarImagensPdv, salvarImagemPdv, type ImagemPdv, type TelaImagem } from '../services/api';
import { formatarDataHora, simNao } from '../utils/formato';

/**
 * Aba "Imagens do PDV" das Configurações da empresa: vitrine da tela de venda do erp-pdv (pdv_imagens). As ativas
 * dentro do período se revezam no painel esquerdo, abaixo do último item lançado (promoções, datas comemorativas).
 * A imagem é reduzida aqui (WebP até 1200 px) antes de ir ao servidor.
 * Com tela = 'cliente', a aba "Imagens da tela do cliente": a mesma tabela (campo tela), imagens verticais (2:3) que
 * se revezam na coluna ao lado do cupom, no segundo monitor virado para o cliente.
 */

interface Form {
  titulo: string;
  data_inicio: string;
  data_fim: string;
  ordem: string;
  ativo: boolean;
  /** Imagem nova (base64 sem o "data:"); vazia na edição mantém a gravada */
  imagem?: string;
  tipo?: string;
  /** data: URL para a prévia */
  previa?: string;
}

const LADO_MAXIMO = 1200;

/** Reduz para no máximo 1200 px no lado maior e grava em WebP (PNG no navegador que não gera WebP) */
async function reduzir(f: File): Promise<{ imagem: string; tipo: string; previa: string }> {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, LADO_MAXIMO / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const previa = c.toDataURL('image/webp', 0.85);
  return { imagem: previa.split(',')[1] ?? '', tipo: previa.slice(5, previa.indexOf(';')), previa };
}

/** Hoje em "aaaa-mm-dd" pelo relógio local */
const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const periodo = (i: ImagemPdv) =>
  i.data_inicio && i.data_fim
    ? `${formatarDataHora(i.data_inicio)} a ${formatarDataHora(i.data_fim)}`
    : i.data_inicio
      ? `A partir de ${formatarDataHora(i.data_inicio)}`
      : i.data_fim
        ? `Até ${formatarDataHora(i.data_fim)}`
        : 'Sempre';

const noAr = (i: ImagemPdv) => {
  const h = hoje();
  return !!i.ativo && (!i.data_inicio || i.data_inicio <= h) && (!i.data_fim || i.data_fim >= h);
};

/** Escolha da imagem com prévia; na edição, mostra a gravada até trocar */
const CampoImagem: React.FC<{ empresaId: number; vertical: boolean; f: Form; alterar: (p: Partial<Form>) => void; editando: ImagemPdv | null; onErro: (m: string) => void }> = ({
  empresaId,
  vertical,
  f,
  alterar,
  editando,
  onErro,
}) => {
  const seletor = useRef<HTMLInputElement>(null);
  const [gravada, setGravada] = useState('');
  useEffect(() => {
    if (!editando) return;
    lerImagemPdv(empresaId, editando.id)
      .then((r) => setGravada(`data:${r.tipo};base64,${r.imagem}`))
      .catch((e: Error) => onErro(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, editando?.id]);
  const previa = f.previa || gravada;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        autoFocus={!editando}
        data-obrigatorio={editando ? undefined : ''}
        onClick={() => seletor.current?.click()}
        className={`${vertical ? "w-32 aspect-[2/3]" : "w-48 aspect-[3/2]"} shrink-0 rounded-md border border-dashed border-stone-300 bg-stone-50 flex items-center justify-center overflow-hidden cursor-pointer hover:bg-stone-100`}
      >
        {previa ? <img src={previa} alt="" className="w-full h-full object-contain" /> : <ImagePlus className="w-6 h-6 text-stone-400" />}
      </button>
      <div className="text-[11px] text-stone-500 space-y-1">
        <button type="button" onClick={() => seletor.current?.click()} className="font-semibold text-blue-600 hover:underline cursor-pointer">
          {previa ? 'Trocar imagem' : 'Escolher imagem'}
        </button>
        <p>JPG, PNG ou WebP. Proporção sugerida {vertical ? 'vertical 2:3 (ex.: 800 × 1200)' : '3:2 (ex.: 1200 × 800)'}; é reduzida para até 1200 px.</p>
      </div>
      <input
        ref={seletor}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (e) => {
          const arq = e.target.files?.[0];
          e.target.value = '';
          if (!arq) return;
          try {
            alterar(await reduzir(arq));
          } catch {
            onErro('Não foi possível ler a imagem.');
          }
        }}
      />
    </div>
  );
};

export const ImagensPdvEmpresa: React.FC<{ empresaId: number; tela: TelaImagem }> = ({ empresaId, tela }) => {
  const cliente = tela === 'cliente';
  const [erro, setErro] = useState<string | null>(null);

  return (
    <>
      <CadastroCrm<ImagemPdv, Form>
        key={empresaId}
        cadastro={cliente ? "empresa_imagens_cliente" : "empresa_imagens_pdv"}
        embutido
        titulo={cliente ? "Imagens da tela do cliente" : "Imagens do caixa"}
        subtitulo=""
        registro="Imagem"
        feminino
        fonte={{
          listar: () => listarImagensPdv(empresaId, tela),
          salvar: (id, { previa: _previa, ordem, ...f }) => salvarImagemPdv(empresaId, id, { ...f, tela, ordem: Number(ordem) || 0 }),
          excluir: (id) => excluirImagemPdv(empresaId, id),
        }}
        nomeDe={(i) => i.titulo || `Imagem ${i.id}`}
        colunas={[
          { key: 'ordem', label: 'Ordem', alinhar: 'numero', largura: 70 },
          { key: 'titulo', label: 'Texto', largura: 240, render: (i) => i.titulo || <span className="text-stone-400">(só a imagem)</span> },
          { key: 'data_inicio', label: 'Período', alinhar: 'centro', largura: 200, render: periodo },
          { key: 'id', label: 'No PDV hoje', alinhar: 'centro', largura: 100, render: (i) => simNao(noAr(i)) },
          { key: 'tamanho', label: 'Tamanho', alinhar: 'numero', largura: 90, render: (i) => `${Math.ceil(i.tamanho / 1024).toLocaleString('pt-BR')} KB` },
          { key: 'ativo', label: 'Ativo', alinhar: 'centro', largura: 70, render: (i) => simNao(i.ativo) },
        ]}
        novo={() => ({ titulo: '', data_inicio: '', data_fim: '', ordem: '0', ativo: true })}
        doRegistro={(i) => ({ titulo: i.titulo ?? '', data_inicio: i.data_inicio ?? '', data_fim: i.data_fim ?? '', ordem: String(i.ordem), ativo: !!i.ativo })}
        validar={(f) => (f.data_inicio && f.data_fim && f.data_fim < f.data_inicio ? 'A data de fim é anterior à de início.' : null)}
        campos={(f, alterar, editando) => (
          <>
            <Campo
              rotulo="Imagem"
              span={4}
              dica={
                cliente
                  ? "Aparece na tela do cliente (segundo monitor), na coluna ao lado do cupom e com o caixa livre, revezando com as outras a cada 8 segundos."
                  : "Aparece na tela de venda do PDV, abaixo do último item lançado, revezando com as outras a cada 8 segundos."
              }
            >
              <CampoImagem empresaId={empresaId} vertical={cliente} f={f} alterar={alterar} editando={editando} onErro={setErro} />
            </Campo>
            <Campo rotulo="Texto" span={2} dica="Opcional: aparece sobre a imagem, no rodapé dela (ex.: Parabéns Mamãe!!).">
              <input autoFocus={!!editando} maxLength={100} value={f.titulo} onChange={(e) => alterar({ titulo: e.target.value })} onFocus={(e) => e.target.select()} className={INPUT_CLASS} />
            </Campo>
            <Campo rotulo="Ordem" dica="Menor primeiro. Mesma ordem: a mais antiga primeiro.">
              <input
                inputMode="numeric"
                value={f.ordem}
                onChange={(e) => alterar({ ordem: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                onFocus={(e) => e.target.select()}
                className={`${INPUT_CLASS} text-right`}
              />
            </Campo>
            <Campo rotulo="Início" dica="Primeiro dia em que aparece. Vazio: desde já.">
              <DateField value={f.data_inicio} onChange={(v) => alterar({ data_inicio: v })} />
            </Campo>
            <Campo rotulo="Fim" dica="Último dia em que aparece. Vazio: sem fim.">
              <DateField value={f.data_fim} onChange={(v) => alterar({ data_fim: v })} />
            </Campo>
            {editando && (
              <Campo rotulo="Ativo" dica="Inativa, a imagem deixa de aparecer no PDV.">
                <div className="h-[34px] flex items-center">
                  <Toggle checked={f.ativo} onChange={(v) => alterar({ ativo: v })} />
                </div>
              </Campo>
            )}
          </>
        )}
      />
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
    </>
  );
};
