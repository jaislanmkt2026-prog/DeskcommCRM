#!/usr/bin/env tsx
/**
 * Importador de teste para dados Engenharq — versão com transação + ROLLBACK.
 * Lê fixture JSON, valida e insere/atualiza no banco dentro de uma transação
 * que é revertida ao final (sem persistir estoque fictício).
 * Uso: pnpm tsx scripts/import-engenharq-test.ts <path-to-json>
 */
import { readFileSync } from "fs";
import { Client } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" });

const ORG_ID = "e6243f24-75e0-427c-8f7f-3654f5e75ed4";
const STATUS_VALIDOS = ["disponivel", "reservado", "vendido", "bloqueado"];

interface EngenharqRecord {
  construtora: string;
  empreendimento: string;
  localizacao?: string;
  bairro?: string;
  cidade?: string;
  unidade_numero: string;
  bloco?: string;
  andar?: number;
  metragem?: number;
  quartos?: number;
  suites?: number;
  vagas?: number;
  tipologia?: string;
  preco_cents: number;
  disponibilidade: string;
  atualizado_em: string;
  origem: string;
}

async function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error("Uso: tsx scripts/import-engenharq-test.ts <path-to-json>");
    process.exit(1);
  }

  let records: EngenharqRecord[];
  try {
    const raw = readFileSync(fixturePath, "utf-8");
    records = JSON.parse(raw);
  } catch (err) {
    console.error(`Erro ao ler fixture: ${err}`);
    process.exit(1);
  }

  if (!process.env.SUPABASE_DB_URL) {
    console.error("SUPABASE_DB_URL não definida no .env.local");
    process.exit(1);
  }

  const client = new Client(process.env.SUPABASE_DB_URL);
  await client.connect();

  // Transação com ROLLBACK forçado — nada persiste
  await client.query("BEGIN");
  try {
    console.log(`Iniciando importação de teste (${records.length} registros)...`);
    let successCount = 0;
    let rejectCount = 0;
    const errors: string[] = [];

    for (const record of records) {
      try {
        await importarRegistro(client, record);
        successCount++;
        console.log(`✓ ${record.unidade_numero} (${record.empreendimento})`);
      } catch (err: any) {
        rejectCount++;
        errors.push(`${record.unidade_numero}: ${err.message}`);
        console.error(`✗ ${record.unidade_numero}: ${err.message}`);
      }
    }

    console.log(`\n=== RESULTADO (TRANSACAO COM ROLLBACK) ===`);
    console.log(`Sucesso: ${successCount}`);
    console.log(`Rejeitados: ${rejectCount}`);
    if (errors.length > 0) {
      console.log("Erros:");
      errors.forEach((e) => console.log(` - ${e}`));
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
    console.log("\nTransação revertida — nenhum dado persistido.");
  }
}

async function importarRegistro(client: Client, record: EngenharqRecord) {
  // Validação 1: preço > 0
  if (!record.preco_cents || record.preco_cents <= 0) {
    throw new Error("Preço inválido (deve ser > 0)");
  }
  // Validação 2: disponibilidade válida
  if (!STATUS_VALIDOS.includes(record.disponibilidade)) {
    throw new Error(`Disponibilidade inválida: ${record.disponibilidade}`);
  }

  // Passo 1: Verificar/criar construtora
  const construtoraRes = await client.query(
    "SELECT id FROM constructors WHERE organization_id = $1 AND nome = $2",
    [ORG_ID, record.construtora],
  );

  let constructorId: string;
  if (construtoraRes.rows.length === 0) {
    const insertRes = await client.query(
      "INSERT INTO constructors (organization_id, nome, tipo_integracao, ativo) VALUES ($1, $2, $3, $4) RETURNING id",
      [ORG_ID, record.construtora, "csv", true],
    );
    constructorId = insertRes.rows[0].id;
  } else {
    constructorId = construtoraRes.rows[0].id;
  }

  // Passo 2: Verificar/criar empreendimento
  const devRes = await client.query(
    "SELECT id FROM real_estate_developments WHERE organization_id = $1 AND nome = $2",
    [ORG_ID, record.empreendimento],
  );

  let developmentId: string;
  if (devRes.rows.length === 0) {
    const insertRes = await client.query(
      "INSERT INTO real_estate_developments (organization_id, constructor_id, nome, localizacao, bairro, cidade, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [
        ORG_ID,
        constructorId,
        record.empreendimento,
        record.localizacao || null,
        record.bairro || null,
        record.cidade || null,
        "em_andamento",
      ],
    );
    developmentId = insertRes.rows[0].id;
  } else {
    developmentId = devRes.rows[0].id;
  }

  // Passo 3: Inserir ou atualizar unidade + histórico
  const unitRes = await client.query(
    "SELECT id, valor_cents, status FROM real_estate_units WHERE organization_id = $1 AND development_id = $2 AND bloco IS NOT DISTINCT FROM $3 AND numero = $4",
    [ORG_ID, developmentId, record.bloco || null, record.unidade_numero],
  );

  if (unitRes.rows.length > 0) {
    const existingUnit = unitRes.rows[0];
    const changes: Array<{ campo: string; anterior: string | null; novo: string }> = [];

    if (String(existingUnit.valor_cents) !== String(record.preco_cents)) {
      changes.push({
        campo: "valor_cents",
        anterior: String(existingUnit.valor_cents),
        novo: String(record.preco_cents),
      });
    }
    if (existingUnit.status !== record.disponibilidade) {
      changes.push({
        campo: "status",
        anterior: existingUnit.status,
        novo: record.disponibilidade,
      });
    }

    await client.query(
      "UPDATE real_estate_units SET valor_cents = $1, status = $2, updated_at = $3 WHERE id = $4",
      [record.preco_cents, record.disponibilidade, record.atualizado_em, existingUnit.id],
    );

    for (const change of changes) {
      await client.query(
        "INSERT INTO real_estate_history (organization_id, unit_id, campo, valor_anterior, valor_novo, fonte) VALUES ($1, $2, $3, $4, $5, $6)",
        [ORG_ID, existingUnit.id, change.campo, change.anterior, change.novo, record.origem],
      );
    }
  } else {
    await client.query(
      "INSERT INTO real_estate_units (organization_id, development_id, bloco, numero, andar, metragem, quartos, suites, vagas, valor_cents, condicoes, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
      [
        ORG_ID,
        developmentId,
        record.bloco || null,
        record.unidade_numero,
        record.andar || null,
        record.metragem || null,
        record.quartos || null,
        record.suites || null,
        record.vagas || null,
        record.preco_cents,
        record.tipologia || null,
        record.disponibilidade,
      ],
    );
  }
}

main().catch((err) => {
  console.error("Falha catastrófica:", err);
  process.exit(1);
});
