
const axios = require('axios');
const mongoose = require('mongoose');
const PncpBid = require('../models/PncpBid');

const PNCP_BASE_URL =
  'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';

const TAMANHO_PAGINA = 10;
const INTERVALO_REQUISICOES_MS = 1500;
const MAX_PAGINAS_POR_EXECUCAO = 100;
const TIMEOUT_MS = 60000;
const MAX_TENTATIVAS = 3;
const DIAS_A_FRENTE = 30;

const CHAVE_SINCRONIZACAO = 'contratacoes-proposta';

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

  // Formato compacto: YYYYMMDD.
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

  // Formato brasileiro: DD/MM/YYYY.
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

      const status = erro.response?.status;
      const mensagem = erro.code || erro.message;

      console.error(
        `[PNCP SYNC] Falha na página ${pagina}; ` +
        `tentativa ${tentativa}/${MAX_TENTATIVAS}; ` +
        `HTTP=${status || 'sem resposta'}; ${mensagem}`
      );

      if (tentativa < MAX_TENTATIVAS) {
        const espera = 2000 * tentativa;
        await esperar(espera);
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

  return estado;
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

  let paginasConsultadas = 0;
  let registrosRecebidos = 0;
  let registrosIgnorados = 0;
  let registrosGravados = 0;
  let totalPaginas = 0;
  let varreduraConcluida = false;

  try {
    const estado = await obterEstado();

    let proximaPagina = estado.proximaPagina;
    const dataFinalDaVarredura = estado.dataFinal;

    totalPaginas = estado.totalPaginas;

    console.log(
      `[PNCP SYNC] Iniciando na página ${proximaPagina}; ` +
      `dataFinal=${dataFinalDaVarredura}; ` +
      `tamanhoPagina=${TAMANHO_PAGINA}; ` +
      `timeout=${TIMEOUT_MS}; ` +
      `totalPaginas=${totalPaginas || 'desconhecido'}`
    );

    for (
      let indice = 0;
      indice < MAX_PAGINAS_POR_EXECUCAO;
      indice += 1
    ) {
      const pagina = proximaPagina;

      const resposta = await buscarPagina(
        pagina,
        dataFinalDaVarredura
      );

      const registros = Array.isArray(resposta?.data)
        ? resposta.data
        : Array.isArray(resposta?.items)
          ? resposta.items
          : [];

      const paginasInformadas = Number(
        resposta?.totalPaginas ??
        resposta?.totalPages ??
        0
      );

      if (
        Number.isFinite(paginasInformadas) &&
        paginasInformadas > 0
      ) {
        totalPaginas = paginasInformadas;
      }

      if (totalPaginas > 0 && pagina > totalPaginas) {
        varreduraConcluida = true;
        proximaPagina = 1;
        break;
      }

      if (registros.length === 0) {
        if (totalPaginas > 0 && pagina < totalPaginas) {
          throw new Error(
            `A página ${pagina} veio vazia, mas a API informa ` +
            `${totalPaginas} páginas. O cursor será preservado.`
          );
        }

        varreduraConcluida = true;
        proximaPagina = 1;
        break;
      }

      const operacoes = [];

      for (const item of registros) {
        const operacao = mapearContratacao(item);

        if (!operacao) {
          registrosIgnorados += 1;
          continue;
        }

        operacoes.push(operacao);
      }

      if (operacoes.length > 0) {
        const resultado = await PncpBid.bulkWrite(
          operacoes,
          { ordered: false }
        );

        registrosGravados +=
          (resultado.upsertedCount || 0) +
          (resultado.modifiedCount || 0);
      }

      paginasConsultadas += 1;
      registrosRecebidos += registros.length;

      console.log(
        `[PNCP SYNC] Página ${pagina}: ` +
        `${registros.length} recebidos; ` +
        `${operacoes.length} operações preparadas; ` +
        `total de páginas=${totalPaginas || 'desconhecido'}.`
      );

      const ultimaPaginaConhecida =
        totalPaginas > 0 && pagina >= totalPaginas;

      if (ultimaPaginaConhecida) {
        varreduraConcluida = true;
        proximaPagina = 1;
      } else {
        proximaPagina = pagina + 1;
      }

      // Salva o cursor somente depois de gravar a página.
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
      paginasConsultadas,
      registrosRecebidos,
      registrosIgnorados,
      registrosGravados,
      totalPaginasConhecidas: totalPaginas,
      proximaPagina: estado.proximaPagina,
      dataFinal: estado.dataFinal,
      varreduraConcluida,
    };

    console.log('[PNCP SYNC] Resultado:', resultado);

    return resultado;
  } catch (erro) {
    console.error(
      '[PNCP SYNC] Erro:',
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
