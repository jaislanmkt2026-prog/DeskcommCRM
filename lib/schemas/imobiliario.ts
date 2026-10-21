import { z } from "zod";

/**
 * Schema Zod para qualificacao_imobiliaria (custom_fields do lead).
 * Fonte única de validação — função SQL anulada pelo CRIVO.
 * Spec: ESPEC_QUALIFICACAO_IMOBILIARIA_SCHEMA.md
 */
export const qualificacaoImobiliariaSchema = z.object({
  finalidade: z.enum([
    "moradia_proprio",
    "investimento_aluguel",
    "investimento_revenda",
    "casa_veraneio",
    "outro",
  ]),
  tipo_imovel: z.enum([
    "apartamento",
    "casa_terrea",
    "sobrado",
    "cobertura",
    "studio",
    "kitnet",
    "lote_terreno",
    "sala_comercial",
    "galpao",
    "outro",
  ]),
  faixa_valor_min_cents: z.number().int().min(0).max(9007199254740991).optional(),
  faixa_valor_max_cents: z.number().int().min(0).max(9007199254740991).optional(),
  quartos_desejados: z.number().int().min(0).max(20).optional(),
  garagem_necessaria: z.boolean().optional(),
  preferencias: z.array(z.string().max(100)).max(20).optional(),
  observacoes_comerciais: z.string().max(2000).optional(),
  estagio_qualificacao: z.enum([
    "inicial",
    "documentacao_pendente",
    "documentacao_completa",
    "pronto_handoff",
    "desqualificado",
  ]),
  ultima_atualizacao: z.string().datetime(),
});

/**
 * Validação de negócio: faixa de valor coerente (min <= max).
 */
export function validarFaixaValor(
  data: z.infer<typeof qualificacaoImobiliariaSchema>,
): { ok: true } | { ok: false; error: string } {
  const { faixa_valor_min_cents, faixa_valor_max_cents } = data;
  if (
    faixa_valor_min_cents !== undefined &&
    faixa_valor_max_cents !== undefined &&
    faixa_valor_min_cents > faixa_valor_max_cents
  ) {
    return {
      ok: false,
      error: "faixa_valor_min_cents não pode ser maior que faixa_valor_max_cents",
    };
  }
  return { ok: true };
}

/**
 * Merge parcial seguro: preserva chaves existentes, atualiza apenas as enviadas,
 * e sempre toca ultima_atualizacao.
 */
export function mergeQualificacaoParcial(
  existing: Record<string, unknown> | null | undefined,
  patch: Partial<z.infer<typeof qualificacaoImobiliariaSchema>>,
): z.infer<typeof qualificacaoImobiliariaSchema> {
  const base =
    existing?.qualificacao_imobiliaria &&
    typeof existing.qualificacao_imobiliaria === "object" &&
    !Array.isArray(existing.qualificacao_imobiliaria)
      ? (existing.qualificacao_imobiliaria as Record<string, unknown>)
      : {};

  const merged = {
    ...base,
    ...patch,
    ultima_atualizacao: new Date().toISOString(),
  } as z.infer<typeof qualificacaoImobiliariaSchema>;

  // Revalida o objeto completo após merge
  const parseResult = qualificacaoImobiliariaSchema.safeParse(merged);
  if (!parseResult.success) {
    throw new Error(`Schema inválido após merge: ${parseResult.error.message}`);
  }

  const faixaValida = validarFaixaValor(merged);
  if (!faixaValida.ok) {
    throw new Error(faixaValida.error);
  }

  return merged;
}
