import { fetchBatch } from "./adapter";
import { reconcileStaleRecords } from "./reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

type IngestSummary = {
  batch_id: string;
  total_records: number;
  valid: number;
  invalid: number;
  processed: number;
  stale_count: number;
  status: "ok" | "error";
  errors?: string[];
};

type AdminClient = ReturnType<typeof createAdminClient>;

async function finalizeLog(
  supabase: AdminClient,
  orgId: string,
  batchId: string,
  values: {
    total_records: number;
    valid_records: number;
    invalid_records: number;
    skipped_records: number;
    processed_records: number;
    status: "completed" | "failed" | "partial";
    error_message: string | null;
  },
): Promise<string | null> {
  const { error } = await supabase
    .from("cv_crm_ingestion_logs")
    .update({
      ...values,
      finished_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .eq("batch_id", batchId);

  return error ? `Falha ao finalizar log de ingestão: ${error.message}` : null;
}

export async function runCvCrmIngest(opts?: {
  orgId?: string;
  /**
   * Mantido apenas por compatibilidade de chamada. Reconciliation exige snapshot
   * completo; truncar o lote localmente produziria stale falso. Paginação só pode
   * ser adicionada quando o contrato da API declarar cursor + snapshot completo.
   */
  batchSize?: number;
}): Promise<IngestSummary> {
  const batchId = crypto.randomUUID();
  const configuredOrgId = env.CV_CRM_ORG_ID.trim();
  const requestedOrgId = opts?.orgId?.trim();

  if (!configuredOrgId) {
    return {
      batch_id: batchId,
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors: ["CV_CRM_ORG_ID não configurada"],
    };
  }

  // O cron usa service_role (auth.uid() = null). Portanto fn_user_org_ids()
  // NÃO é uma whitelist válida aqui. O tenant autorizado vem da configuração
  // server-side e qualquer override divergente é recusado.
  if (requestedOrgId && requestedOrgId !== configuredOrgId) {
    return {
      batch_id: batchId,
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors: ["Tenant solicitado diverge de CV_CRM_ORG_ID"],
    };
  }

  const orgId = configuredOrgId;
  const supabase = createAdminClient();

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();

  if (organizationError || !organization) {
    return {
      batch_id: batchId,
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors: [
        organizationError
          ? `Falha ao validar CV_CRM_ORG_ID: ${organizationError.message}`
          : "CV_CRM_ORG_ID não corresponde a uma organização existente",
      ],
    };
  }

  // Recupera lock abandonado por processo morto. Um batch ativo recente continua
  // protegido pelo indice parcial uq_cv_crm_one_running_per_org.
  const staleRunningCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { error: staleRunningError } = await supabase
    .from("cv_crm_ingestion_logs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: "batch running expirou apos 1h; lock liberado automaticamente",
    })
    .eq("organization_id", orgId)
    .eq("status", "running")
    .lt("started_at", staleRunningCutoff);

  if (staleRunningError) {
    return {
      batch_id: batchId,
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors: [`Falha ao recuperar lock CV CRM: ${staleRunningError.message}`],
    };
  }

  // O log nasce ANTES do acesso à fonte. Assim indisponibilidade, timeout e
  // payload inválido deixam evidência auditável, em vez de desaparecer antes do
  // primeiro INSERT. O indice parcial da 0529 também funciona como lock.
  const { error: logInsertError } = await supabase.from("cv_crm_ingestion_logs").insert({
    organization_id: orgId,
    batch_id: batchId,
    started_at: new Date().toISOString(),
    source: "cv_crm",
    total_records: 0,
    status: "running",
  });

  if (logInsertError) {
    return {
      batch_id: batchId,
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors: [`Falha ao criar log de ingestão: ${logInsertError.message}`],
    };
  }

  let records: Awaited<ReturnType<typeof fetchBatch>>;
  try {
    // Sem "since": este endpoint é tratado como snapshot completo. Reconciliation
    // de stale nunca pode usar janela incremental, pois ausência numa janela de
    // 24h não significa ausência na fonte oficial.
    records = await fetchBatch(orgId);
  } catch (error) {
    const errors = [error instanceof Error ? error.message : String(error)];
    const logError = await finalizeLog(supabase, orgId, batchId, {
      total_records: 0,
      valid_records: 0,
      invalid_records: 0,
      skipped_records: 0,
      processed_records: 0,
      status: "failed",
      error_message: errors.join("; "),
    });
    if (logError) errors.push(logError);

    return {
      batch_id: batchId,
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors,
    };
  }

  const { error: totalLogError } = await supabase
    .from("cv_crm_ingestion_logs")
    .update({ total_records: records.length })
    .eq("organization_id", orgId)
    .eq("batch_id", batchId);

  if (totalLogError) {
    const errors = [`Falha ao atualizar total do log: ${totalLogError.message}`];
    const logError = await finalizeLog(supabase, orgId, batchId, {
      total_records: records.length,
      valid_records: 0,
      invalid_records: 0,
      skipped_records: records.length,
      processed_records: 0,
      status: "failed",
      error_message: errors.join("; "),
    });
    if (logError) errors.push(logError);

    return {
      batch_id: batchId,
      total_records: records.length,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors,
    };
  }

  const errors: string[] = [];
  let blockingError = false;
  let validCount = 0;
  let invalidCount = 0;

  for (const record of records) {
    const { data: validationResult, error: validationRpcError } = await supabase.rpc(
      "fn_validate_cv_crm_record",
      {
        p_entity_type: record.entity_type,
        p_raw_payload: record.payload,
      },
    );

    if (validationRpcError) {
      invalidCount += 1;
      blockingError = true;
      errors.push(
        `${record.external_id}: erro na validação RPC: ${validationRpcError.message}`,
      );
      continue;
    }

    const isValid =
      validationResult !== null &&
      typeof validationResult === "object" &&
      "valid" in validationResult &&
      validationResult.valid === true;

    const validationErrors =
      validationResult !== null &&
      typeof validationResult === "object" &&
      "errors" in validationResult &&
      Array.isArray(validationResult.errors)
        ? validationResult.errors.map(String)
        : [];

    const { error: stagingError } = await supabase.from("cv_crm_staging").upsert(
      {
        organization_id: orgId,
        batch_id: batchId,
        entity_type: record.entity_type,
        external_id: record.external_id,
        raw_payload: record.payload,
        validation_status: isValid ? "valid" : "invalid",
        validation_errors: validationErrors,
      },
      { onConflict: "organization_id,batch_id,entity_type,external_id" },
    );

    if (stagingError) {
      invalidCount += 1;
      blockingError = true;
      errors.push(
        `${record.external_id}: falha ao escrever staging: ${stagingError.message}`,
      );
      continue;
    }

    if (isValid) {
      validCount += 1;
    } else {
      invalidCount += 1;
      errors.push(
        `${record.external_id}: payload inválido: ${
          validationErrors.length > 0 ? validationErrors.join(", ") : "sem detalhe"
        }`,
      );
    }
  }

  let processedCount = 0;
  let applySucceeded = validCount === 0 && !blockingError;

  if (validCount > 0 && !blockingError) {
    const { data: applied, error: applyError } = await supabase.rpc(
      "fn_apply_cv_crm_valid_records",
      {
        p_organization_id: orgId,
        p_batch_id: batchId,
      },
    );

    if (applyError) {
      blockingError = true;
      errors.push(`Falha ao aplicar registros válidos: ${applyError.message}`);
    } else {
      const appliedCount = typeof applied === "number" ? applied : Number(applied);
      if (!Number.isInteger(appliedCount) || appliedCount !== validCount) {
        blockingError = true;
        errors.push(
          `Aplicação inconsistente: staging válido=${validCount}, aplicado=${String(applied)}`,
        );
      } else {
        processedCount = appliedCount;
        applySucceeded = true;
      }
    }
  }

  let staleCount = 0;

  // Uma linha inválida torna o snapshot incompleto para fins de ausência.
  // Os registros válidos podem ser aplicados, mas stale só é calculado quando
  // TODO o snapshot foi validado e aplicado sem erro de infraestrutura.
  if (applySucceeded && invalidCount === 0 && !blockingError) {
    const snapshotExternalIds = {
      development: records
        .filter((record) => record.entity_type === "development")
        .map((record) => record.external_id),
      unit: records
        .filter((record) => record.entity_type === "unit")
        .map((record) => record.external_id),
    };

    try {
      const result = await reconcileStaleRecords(orgId, snapshotExternalIds);
      staleCount = result.staleCount;
      if (result.errors.length > 0) {
        blockingError = true;
        errors.push(...result.errors.map((error) => `reconcile: ${error}`));
      }
    } catch (error) {
      blockingError = true;
      errors.push(`reconcile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const hasFailure = blockingError || invalidCount > 0 || errors.length > 0;
  const finalStatus: "completed" | "failed" | "partial" = hasFailure
    ? processedCount > 0
      ? "partial"
      : "failed"
    : "completed";

  const logError = await finalizeLog(supabase, orgId, batchId, {
    total_records: records.length,
    valid_records: validCount,
    invalid_records: invalidCount,
    skipped_records: records.length - validCount - invalidCount,
    processed_records: processedCount,
    status: finalStatus,
    error_message: errors.length > 0 ? errors.join("; ") : null,
  });
  if (logError) {
    errors.push(logError);
  }

  return {
    batch_id: batchId,
    total_records: records.length,
    valid: validCount,
    invalid: invalidCount,
    processed: processedCount,
    stale_count: staleCount,
    status: hasFailure || logError ? "error" : "ok",
    errors: errors.length > 0 ? errors : undefined,
  };
}
