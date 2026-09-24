// Set these public values in this file for GitHub Pages, or in window.NEXTWEBEC_CONFIG.
// Never put a Supabase service_role key here.
export const config = window.NEXTWEBEC_CONFIG || { supabaseUrl: '', supabaseAnonKey: '' };
export const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
