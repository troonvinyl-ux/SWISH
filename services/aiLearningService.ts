// SWISH AI Learning Service
//
// Records user feedback on AI identifications so the swish-identify edge function
// can improve future results by including recent corrections in its prompt context.
//
// Table: ai_id_feedback
//   feedback: 'correct' | 'incorrect' | 'partial'
//   error_category: 'wrong_identity' | 'wrong_date' | 'wrong_condition' |
//                   'wrong_ruler' | 'wrong_denomination' | 'wrong_country' | 'other'

import { getSupabaseClient } from '@/template';

export type FeedbackVerdict = 'correct' | 'incorrect' | 'partial';

export type ErrorCategory =
  | 'wrong_identity'
  | 'wrong_date'
  | 'wrong_condition'
  | 'wrong_ruler'
  | 'wrong_denomination'
  | 'wrong_country'
  | 'wrong_material'
  | 'wrong_valuation'
  | 'other';

export interface AIFeedbackRecord {
  id: string;
  tenantId: string;
  itemId?: string;
  specialistId: string;
  aiCanonicalTitle: string;
  aiAttributes: Record<string, any>;
  aiConfidence: number;
  originalCanonicalTitle: string;
  originalAttributes: Record<string, any>;
  feedback: FeedbackVerdict;
  correctionNotes: string;
  errorCategory?: ErrorCategory;
  imageUrls: string[];
  createdAt: string;
}

export interface RecordFeedbackInput {
  tenantId: string;
  itemId?: string;
  specialistId: string;
  // What the AI said
  aiCanonicalTitle: string;
  aiAttributes?: Record<string, any>;
  aiConfidence?: number;
  // What was correct (original or user-provided)
  originalCanonicalTitle: string;
  originalAttributes?: Record<string, any>;
  // Verdict
  feedback: FeedbackVerdict;
  correctionNotes?: string;
  errorCategory?: ErrorCategory;
  // Images used in this ID attempt
  imageUrls?: string[];
}

// ── Record feedback after a Re-ID attempt ─────────────────────────────────────

export async function recordAIFeedback(
  input: RecordFeedbackInput,
): Promise<{ id: string | null; error: string | null }> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('ai_id_feedback')
      .insert({
        tenant_id: input.tenantId,
        item_id: input.itemId ?? null,
        specialist_id: input.specialistId,
        ai_canonical_title: input.aiCanonicalTitle,
        ai_attributes: input.aiAttributes ?? {},
        ai_confidence: input.aiConfidence ?? 0,
        original_canonical_title: input.originalCanonicalTitle,
        original_attributes: input.originalAttributes ?? {},
        feedback: input.feedback,
        correction_notes: input.correctionNotes ?? '',
        error_category: input.errorCategory ?? null,
        image_urls: input.imageUrls ?? [],
      })
      .select('id')
      .single();

    if (error) return { id: null, error: error.message };
    return { id: data?.id ?? null, error: null };
  } catch (e: any) {
    return { id: null, error: e?.message ?? 'Failed to record feedback' };
  }
}

// ── Fetch recent corrections for a specialist domain ──────────────────────────
// Used by swish-identify to inject corrections into the AI prompt.
// Returns only 'incorrect' / 'partial' entries — what the AI got wrong.

export async function getRecentCorrections(
  tenantId: string,
  specialistId: string,
  limit = 5,
): Promise<AIFeedbackRecord[]> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('ai_id_feedback')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('specialist_id', specialistId)
      .in('feedback', ['incorrect', 'partial'])
      .order('created_at', { ascending: false })
      .limit(limit);

    return (data ?? []).map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      itemId: row.item_id,
      specialistId: row.specialist_id,
      aiCanonicalTitle: row.ai_canonical_title,
      aiAttributes: row.ai_attributes ?? {},
      aiConfidence: row.ai_confidence ?? 0,
      originalCanonicalTitle: row.original_canonical_title,
      originalAttributes: row.original_attributes ?? {},
      feedback: row.feedback,
      correctionNotes: row.correction_notes ?? '',
      errorCategory: row.error_category,
      imageUrls: row.image_urls ?? [],
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

// ── Fetch stats for the learning layer ────────────────────────────────────────

export interface LearningStats {
  totalFeedback: number;
  correctCount: number;
  incorrectCount: number;
  partialCount: number;
  accuracyPct: number;
  topErrorCategories: Array<{ category: string; count: number }>;
}

export async function getLearningStats(tenantId: string): Promise<LearningStats> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('ai_id_feedback')
      .select('feedback, error_category')
      .eq('tenant_id', tenantId);

    const rows = data ?? [];
    const correct = rows.filter(r => r.feedback === 'correct').length;
    const incorrect = rows.filter(r => r.feedback === 'incorrect').length;
    const partial = rows.filter(r => r.feedback === 'partial').length;
    const total = rows.length;

    const categoryCounts: Record<string, number> = {};
    for (const row of rows) {
      if (row.error_category) {
        categoryCounts[row.error_category] = (categoryCounts[row.error_category] ?? 0) + 1;
      }
    }
    const topErrorCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    return {
      totalFeedback: total,
      correctCount: correct,
      incorrectCount: incorrect,
      partialCount: partial,
      accuracyPct: total > 0 ? Math.round((correct / total) * 100) : 0,
      topErrorCategories,
    };
  } catch {
    return { totalFeedback: 0, correctCount: 0, incorrectCount: 0, partialCount: 0, accuracyPct: 0, topErrorCategories: [] };
  }
}
