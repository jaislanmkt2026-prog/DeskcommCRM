/**
 * Redaction de dados sensíveis (CPF, RG, telefone, e-mail) para logs e respostas do agente.
 * Usa regex para detectar padrões e substituir por máscaras [REDACTED:<tipo>].
 */

// CPF: XXX.XXX.XXX-XX ou 11 dígitos consecutivos
const CPF_REGEX = /\b(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})\b/g;

// RG: XX.XXX.XXX-X ou X.XXX.XXX ou XXXXXXXX-X (variações comuns)
const RG_REGEX = /\b(\d{2}\.\d{3}\.\d{3}-\w|\d\.\d{3}\.\d{3}|\d{8}-\w)\b/gi;

// Telefone: (XX) XXXXX-XXXX, (XX) XXXX-XXXX, XX XXXXX-XXXX, etc.
const PHONE_REGEX = /\(?\d{2}\)?\s?\d{4,5}-?\d{4}\b/g;

// E-mail: usuario@dominio.tld
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

export function redactCPF(text: string): string {
  return text.replace(CPF_REGEX, "[CPF REDACTED]");
}

export function redactRG(text: string): string {
  return text.replace(RG_REGEX, "[RG REDACTED]");
}

export function redactPhone(text: string): string {
  return text.replace(PHONE_REGEX, "[PHONE REDACTED]");
}

export function redactEmail(text: string): string {
  return text.replace(EMAIL_REGEX, "[EMAIL REDACTED]");
}

/**
 * Aplica todas as máscaras em ordem (CPF antes de RG para evitar falso positivo).
 */
export function redactSensitive(text: string): string {
  let result = text;
  result = redactCPF(result);
  result = redactRG(result);
  result = redactPhone(result);
  result = redactEmail(result);
  return result;
}
