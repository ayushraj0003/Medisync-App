// lib/supabase.ts
// import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } from '@env';

console.log("Supabase URL:", NEXT_PUBLIC_SUPABASE_URL);
console.log("Supabase Key:", NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);