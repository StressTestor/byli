import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, HealthCheck } from '@/types/database';

// run_db_health_check() returns a summary object and writes the individual
// checks to health_checks tagged with its run_id. Show that run's rows, or the
// latest stored rows when the run itself fails (non-admin, network).
export async function runHealthCheck(
  supabase: SupabaseClient<Database>,
  limit: number,
): Promise<HealthCheck[]> {
  const { data: summary, error } = await supabase.rpc('run_db_health_check');
  if (error) console.error('[health] run_db_health_check failed:', error.message);

  const runId =
    !error && summary && typeof summary === 'object' && !Array.isArray(summary)
      ? summary.run_id
      : null;

  let query = supabase
    .from('health_checks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (typeof runId === 'string') query = query.eq('run_id', runId);

  const { data, error: readError } = await query;
  if (readError) console.error('[health] reading health_checks failed:', readError.message);
  return data ?? [];
}
