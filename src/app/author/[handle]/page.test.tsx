import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state=vi.hoisted(()=>({followers:null as number|null}));
vi.mock('@/lib/public-page-data',()=>({getAuthor:async()=>({id:'a',handle:'author',display_name:'Author',article_count:0,follower_count:state.followers})}));
vi.mock('@/lib/supabase-admin',()=>({supabaseAdmin:{from:()=>{const q:any={select:()=>q,eq:()=>q,order:async()=>({data:[]})};return q;}}}));
import AuthorPage from './page';
it.each([[null,'null followers'],[0,'0 followers'],[1200,'1.2K followers']] as const)('preserves previous follower text for %s',async(value,expected)=>{
 state.followers=value;
 const html=renderToStaticMarkup(await AuthorPage({params:Promise.resolve({handle:'author'})}));
 expect(html).toContain(expected);
});
