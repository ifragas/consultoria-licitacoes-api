
const axios = require('axios');
const mongoose = require('mongoose');
const PncpBid = require('../models/PncpBid');

const PNCP_BASE_URL =
  'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';

const TAMANHO_PAGINA = 10;
const INTERVALO_REQUISICOES_MS = 1500;
const MAX_PAGINAS_POR_EXECUCAO = 100;
const MAX_PAGINAS_RECUPERACAO = 10;
const TIMEOUT_MS = 60000;
const MAX_TENTATIVAS = 3;
const DIAS_A_FRENTE = 30;

const CHAVE_SINCRONIZACAO = 'contratacoes-proposta';

const PaginaComFalhaSchema = new mongoose.Schema(
  {
    pagina: { type: Number, required: true },
    dataFinal: { type: String, required: true },
    tentativas: { type: Number, default: 0 },
    ultimoErro: { type: String, default: '' },
    registradaEm: { type: Date, default: Date.now },
  },
  { _id: false }
);

const PncpSyncState =
  mongoose.models.PncpSyncState ||
  mongoose.model(
    'PncpSyncState',
    new mongoose.Schema(
      {
        chave: {
          type: String,
          required: true,
          unique: true,
        },
        proximaPagina: {
          type: Number,
          default: 1,
        },
        dataFinal: {
          type: String,
          default: '',
        },
        totalPaginas: {
          type: Number,
          default: 0,
        },
        ultimaExecucao: {
          type: Date,
          default: null,
        },
        paginasComFalha: {
          type: [PaginaComFalhaSchema],
          default: [],
        },
      },
      {
        collection: 'pncp_sync_state',
        timestamps: true,
      }
    )
  );

let sincronizacaoEmAndamento = false;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dataHojeBrasil() {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const valores = Object.fromEntries(
    partes.map((parte) => [parte.type, parte.value])
  );

  return `${valores.year}${valores.month}${valores.day}`;
}

function dataDiasDepois(dataBase, dias) {
  const ano = Number(dataBase.slice(0, 4));
  const mes = Number(dataBase.slice(4, 6)) - 1;
  const dia = Number(dataBase.slice(6, 8));

  const data = new Date(Date.UTC(ano, mes, dia));
  data.setUTCDate(data.getUTCDate() + dias);

  return [
    data.getUTCFullYear(),
    String(data.getUTCMonth() + 1).padStart(2, '0'),
    String(data.getUTCDate()).padStart(2, '0'),
  ].join('');
}

function converterData(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }

  if (typeof valor === 'number') {
    const dataNumerica = new Date(valor);
    return Number.isNaN(dataNumerica.getTime())
      ? null
      : dataNumerica;
  }

  const texto = String(valor).trim();

  if (!texto) return null;

  if (/^\d{8}$/.test(texto)) {
    const ano = Number(texto.slice(0, 4));
    const mes = Number(texto.slice(4, 6));
    const dia = Number(texto.slice(6, 8));

    const data = new Date(Date.UTC(ano, mes - 1, dia));

    if (
      data.getUTCFullYear() !== ano ||
      data.getUTCMonth() !== mes - 1 ||
      data.getUTCDate() !== dia
    ) {
      return null;
    }

    return data;
  }

  const brasileira = texto.match(
    /^(\d{2})\/(\d{2})\/(\d{4})$/
  );

  if (brasileira) {
    return converterData(
      `${brasileira[3]}${brasileira[2]}${brasileira[1]}`
    );
  }

  const data = new Date(texto);

  return Number.isNaN(data.getTime()) ? null : data;
}

function primeiroValor(...valores) {
  return (
    valores.find(
      (valor) =>
        valor !== undefined &&
        valor !== null &&
        valor !== ''
    ) ?? null
  );
}

function converterNumero(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }

  const numero = Number(valor);

  return Number.isFinite(numero) ? numero : null;
}

function mapearContratacao(item) {
  const identificador = primeiroValor(
    item.numeroControlePNCP,
    item.numeroControlePncp,
    item.id
  );

  if (!identificador) return null;

  const orgao = item.orgaoEntidade || {};
  const unidade = item.unidadeOrgao || {};

  const municipio = primeiroValor(
    unidade.municipioNome,
    unidade.nomeMunicipio,
    item.municipioNome,
    item.municipio,
    ''
  );

  const uf = primeiroValor(
    unidade.ufSigla,
    unidade.uf,
    item.uf,
    ''
  );

  const urlPncp = primeiroValor(
    item.linkSistemaOrigem,
    item.urlPncp,
    ''
  );

  return {
    updateOne: {
      filter: {
        numeroControlePNCP: String(identificador),
      },
      update: {
        $set: {
          numeroControlePNCP: String(identificador),
          objetoCompra: String(item.objetoCompra || ''),
          informacaoComplementar: String(
            item.informacaoComplementar || ''
          ),
          modalidadeId: converterNumero(item.modalidadeId),
          modalidadeNome: String(item.modalidadeNome || ''),
          orgaoCnpj: String(orgao.cnpj || ''),
          orgaoNome: String(orgao.razaoSocial || ''),
          unidadeNome: String(unidade.nomeUnidade || ''),
          uf: String(uf || '').toUpperCase(),
          municipio: String(municipio || ''),
          anoCompra: converterNumero(item.anoCompra),
          sequencialCompra: String(
            item.sequencialCompra ?? ''
          ),
          valorTotalEstimado: converterNumero(
            item.valorTotalEstimado
          ),
          dataPublicacaoPncp: converterData(
            item.dataPublicacaoPncp
          ),
          dataAberturaProposta: converterData(
            item.dataAberturaProposta
          ),
          dataEncerramentoProposta: converterData(
            item.dataEncerramentoProposta
          ),
          situacaoCompra: String(
            item.situacaoCompraNome || ''
          ),
          urlPncp: String(urlPncp || ''),
          dadosOriginais: item,
          sincronizadoEm: new Date(),
        },
      },
      upsert: true,
    },
  };
}

function obterMensagemErro(erro) {
  const status = erro.response?.status;
  const mensagem = erro.code || erro.message || 'Erro desconhecido';

  return `HTTP=${status || 'sem resposta'}; ${mensagem}`;
}

async function buscarPagina(pagina, dataFinal) {
  let ultimoErro;

  for (
    let tentativa = 1;
    tentativa <= MAX_TENTATIVAS;
    tentativa += 1
  ) {
    try {
      const resposta = await axios.get(PNCP_BASE_URL, {
        params: {
          pagina,
          tamanhoPagina: TAMANHO_PAGINA,
          dataFinal,
        },
        timeout: TIMEOUT_MS,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Gestorae-PNCP-Sync/1.0',
        },
      });

      return resposta.data;
    } catch (erro) {
      ultimoErro = erro;

      console.error(
        `[PNCP SYNC] Falha na página ${pagina}; ` +
        `tentativa ${tentativa}/${MAX_TENTATIVAS}; ` +
        obterMensagemErro(erro)
      );

      if (tentativa < MAX_TENTATIVAS) {
        // Esperas progressivas: 3 s e 6 s.
        await esperar(3000 * tentativa);
      }
    }
  }

  throw ultimoErro;
}

async function obterEstado() {
  const dataFinalNova = dataDiasDepois(
    dataHojeBrasil(),
    DIAS_A_FRENTE
  );

  let estado = await PncpSyncState.findOne({
    chave: CHAVE_SINCRONIZACAO,
  });

  if (!estado) {
    try {
      estado = await PncpSyncState.create({
        chave: CHAVE_SINCRONIZACAO,
        proximaPagina: 1,
        dataFinal: dataFinalNova,
        totalPaginas: 0,
        paginasComFalha: [],
      });
    } catch (erro) {
      if (erro.code !== 11000) throw erro;

      estado = await PncpSyncState.findOne({
        chave: CHAVE_SINCRONIZACAO,
      });
    }
  }

  if (!estado) {
    throw new Error(
      'Não foi possível carregar o estado da sincronização PNCP.'
    );
  }

  if (
    !estado.dataFinal ||
    estado.proximaPagina < 1 ||
    (
      estado.totalPaginas > 0 &&
      estado.proximaPagina > estado.totalPaginas
    )
  ) {
    estado.proximaPagina = 1;
    estado.dataFinal = dataFinalNova;
    estado.totalPaginas = 0;
    await estado.save();
  }

  // Compatibilidade com documentos criados antes desta versão.
  if (!Array.isArray(estado.paginasComFalha)) {
    estado.paginasComFalha = [];
  }

  return estado;
}

async function registrarFalha(
  estado,
  pagina,
  dataFinal,
  erro
) {
  const mensagem = obterMensagemErro(erro);

  const falhaExistente = estado.paginasComFalha.find(
    (item) =>
      item.pagina === pagina &&
      item.dataFinal === dataFinal
  );

  if (falhaExistente) {
    falhaExistente.tentativas =
      Number(falhaExistente.tentativas || 0) +
      MAX_TENTATIVAS;

    falhaExistente.ultimoErro = mensagem;
    falhaExistente.registradaEm = new Date();
  } else {
    estado.paginasComFalha.push({
      pagina,
      dataFinal,
      tentativas: MAX_TENTATIVAS,
      ultimoErro: mensagem,
      registradaEm: new Date(),
    });
  }

  estado.ultimaExecucao = new Date();
  await estado.save();

  console.error(
    `[PNCP SYNC] Página ${pagina} registrada para recuperação. ` +
    `dataFinal=${dataFinal}; ${mensagem}`
  );
}

async function removerFalha(estado, pagina, dataFinal) {
  estado.paginasComFalha = estado.paginasComFalha.filter(
    (item) =>
      !(
        item.pagina === pagina &&
        item.dataFinal === dataFinal
      )
  );

  estado.ultimaExecucao = new Date();
  await estado.save();
}

async function gravarRegistros(registros) {
  const operacoes = [];
  let registrosIgnorados = 0;

  for (const item of registros) {
    const operacao = mapearContratacao(item);

    if (!operacao) {
      registrosIgnorados += 1;
      continue;
    }

    operacoes.push(operacao);
  }

  let registrosGravados = 0;

  if (operacoes.length > 0) {
    const resultado = await PncpBid.bulkWrite(
      operacoes,
      { ordered: false }
    );

    registrosGravados =
      (resultado.upsertedCount || 0) +
      (resultado.modifiedCount || 0);
  }

  return {
    operacoesPreparadas: operacoes.length,
    registrosIgnorados,
    registrosGravados,
  };
}

async function processarPagina(estado, pagina, dataFinal) {
  const resposta = await buscarPagina(pagina, dataFinal);

  const registros = Array.isArray(resposta?.data)
    ? resposta.data
    : Array.isArray(resposta?.items)
      ? resposta.items
      : [];

  const totalPaginas = Number(
    resposta?.totalPaginas ??
    resposta?.totalPages ??
    0
  );

  if (
    registros.length === 0 &&
    totalPaginas > 0 &&
    pagina < totalPaginas
  ) {
    throw new Error(
      `A página ${pagina} veio vazia, mas a API informa ` +
      `${totalPaginas} páginas.`
    );
  }

  const gravacao = await gravarRegistros(registros);

  console.log(
    `[PNCP SYNC] Página ${pagina}: ` +
    `${registros.length} recebidos; ` +
    `${gravacao.operacoesPreparadas} operações preparadas; ` +
    `registros gravados/atualizados=${gravacao.registrosGravados}; ` +
    `total de páginas=${totalPaginas || 'desconhecido'}.`
  );

  return {
    registrosRecebidos: registros.length,
    totalPaginas,
    ...gravacao,
  };
}

async function recuperarPaginasComFalha(estado, estatisticas) {
  // Recuperamos um lote limitado para que a varredura principal
  // também tenha tempo de avançar nesta execução.
  const pendentes = estado.paginasComFalha
    .slice(0, MAX_PAGINAS_RECUPERACAO)
    .map((item) => ({
      pagina: item.pagina,
      dataFinal: item.dataFinal,
    }));

  if (pendentes.length === 0) {
    return;
  }

  console.log(
    `[PNCP SYNC] Iniciando recuperação de ${pendentes.length} página(s) pendente(s).`
  );

  for (let indice = 0; indice < pendentes.length; indice += 1) {
    const pendente = pendentes[indice];

    try {
      const resultado = await processarPagina(
        estado,
        pendente.pagina,
        pendente.dataFinal
      );

      await removerFalha(
        estado,
        pendente.pagina,
        pendente.dataFinal
      );

      estatisticas.paginasRecuperadas += 1;
      estatisticas.registrosRecebidos +=
        resultado.registrosRecebidos;
      estatisticas.registrosIgnorados +=
        resultado.registrosIgnorados;
      estatisticas.registrosGravados +=
        resultado.registrosGravados;

      console.log(
        `[PNCP SYNC] Página ${pendente.pagina} recuperada com sucesso.`
      );
    } catch (erro) {
      // A falha permanece salva para a próxima execução.
      console.error(
        `[PNCP SYNC] Recuperação da página ${pendente.pagina} falhou: ` +
        obterMensagemErro(erro)
      );

      const falha = estado.paginasComFalha.find(
        (item) =>
          item.pagina === pendente.pagina &&
          item.dataFinal === pendente.dataFinal
      );

      if (falha) {
        falha.tentativas =
          Number(falha.tentativas || 0) + MAX_TENTATIVAS;
        falha.ultimoErro = obterMensagemErro(erro);
        falha.registradaEm = new Date();
      }

      estado.ultimaExecucao = new Date();
      await estado.save();

      estatisticas.paginasAindaComFalha += 1;
    }

    if (indice < pendentes.length - 1) {
      await esperar(INTERVALO_REQUISICOES_MS);
    }
  }
}

async function sincronizarPncp() {
  if (sincronizacaoEmAndamento) {
    return {
      sucesso: false,
      mensagem: 'Já existe uma sincronização em andamento.',
    };
  }

  if (mongoose.connection.readyState !== 1) {
    throw new Error(
      'MongoDB não está conectado. Sincronização cancelada.'
    );
  }

  sincronizacaoEmAndamento = true;

  const inicio = new Date();

  const estatisticas = {
    paginasConsultadas: 0,
    paginasRecuperadas: 0,
    paginasAindaComFalha: 0,
    registrosRecebidos: 0,
    registrosIgnorados: 0,
    registrosGravados: 0,
  };

  let totalPaginas = 0;
  let varreduraConcluida = false;

  try {
    const estado = await obterEstado();

    // Primeiro tentamos recuperar falhas antigas. Cada página
    // mantém a dataFinal original da consulta em que falhou.
    await recuperarPaginasComFalha(estado, estatisticas);

    let proximaPagina = estado.proximaPagina;
    const dataFinalDaVarredura = estado.dataFinal;

    totalPaginas = estado.totalPaginas;

    console.log(
      `[PNCP SYNC] Iniciando na página ${proximaPagina}; ` +
      `dataFinal=${dataFinalDaVarredura}; ` +
      `tamanhoPagina=${TAMANHO_PAGINA}; ` +
      `timeout=${TIMEOUT_MS}; ` +
      `totalPaginas=${totalPaginas || 'desconhecido'}; ` +
      `falhas pendentes=${estado.paginasComFalha.length}`
    );

    for (
      let indice = 0;
      indice < MAX_PAGINAS_POR_EXECUCAO;
      indice += 1
    ) {
      const pagina = proximaPagina;

      try {
        const resultado = await processarPagina(
          estado,
          pagina,
          dataFinalDaVarredura
        );

        estatisticas.paginasConsultadas += 1;
        estatisticas.registrosRecebidos +=
          resultado.registrosRecebidos;
        estatisticas.registrosIgnorados +=
          resultado.registrosIgnorados;
        estatisticas.registrosGravados +=
          resultado.registrosGravados;

        if (resultado.totalPaginas > 0) {
          totalPaginas = resultado.totalPaginas;
        }

        // Se esta página já estava registrada como falha,
        // removemos a pendência após a gravação bem-sucedida.
        await removerFalha(
          estado,
          pagina,
          dataFinalDaVarredura
        );
      } catch (erro) {
        console.error(
          `[PNCP SYNC] Não foi possível processar a página ${pagina}. ` +
          `A sincronização continuará. ${obterMensagemErro(erro)}`
        );

        await registrarFalha(
          estado,
          pagina,
          dataFinalDaVarredura,
          erro
        );
      }

      const ultimaPaginaConhecida =
        totalPaginas > 0 && pagina >= totalPaginas;

      if (ultimaPaginaConhecida) {
        varreduraConcluida = true;
        proximaPagina = 1;
      } else {
        // Mesmo quando uma página falha, avançamos o cursor.
        // A página permanece registrada para recuperação.
        proximaPagina = pagina + 1;
      }

      estado.proximaPagina = proximaPagina;
      estado.totalPaginas = totalPaginas;
      estado.ultimaExecucao = new Date();

      await estado.save();

      if (varreduraConcluida) {
        break;
      }

      if (indice < MAX_PAGINAS_POR_EXECUCAO - 1) {
        await esperar(INTERVALO_REQUISICOES_MS);
      }
    }

    if (varreduraConcluida) {
      estado.proximaPagina = 1;
      estado.dataFinal = dataDiasDepois(
        dataHojeBrasil(),
        DIAS_A_FRENTE
      );
      estado.totalPaginas = 0;
      estado.ultimaExecucao = new Date();

      await estado.save();
    }

    const resultado = {
      sucesso: true,
      inicio: inicio.toISOString(),
      fim: new Date().toISOString(),
      ...estatisticas,
      totalPaginasConhecidas: totalPaginas,
      proximaPagina: estado.proximaPagina,
      dataFinal: estado.dataFinal,
      varreduraConcluida,
      totalPaginasComFalhaPendentes:
        estado.paginasComFalha.length,
    };

    console.log('[PNCP SYNC] Resultado:', resultado);

    return resultado;
  } catch (erro) {
    console.error(
      '[PNCP SYNC] Erro geral:',
      erro.response?.status || '',
      erro.message
    );

    throw erro;
  } finally {
    sincronizacaoEmAndamento = false;
  }
}

module.exports = {
  sincronizarPncp,
};
