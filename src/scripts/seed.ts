/**
 * Seed script: populates Supabase with the same articles
 * from the MVP frontend, making the transition from mock to real seamless.
 * 
 * Run: npm run db:seed
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SEED_AUTHORS = [
  { handle: 'sarahchenai', display_name: 'Sarah Chen', verified: true, follower_count: 142000 },
  { handle: 'mwebb_sec', display_name: 'Marcus Webb', verified: true, follower_count: 56000 },
  { handle: 'dianawrites', display_name: 'Diana Okafor', verified: true, follower_count: 89000 },
  { handle: 'rajpatel_bio', display_name: 'Dr. Raj Patel', verified: true, follower_count: 67000 },
  { handle: 'jtrier', display_name: 'Jason Trier', verified: false, follower_count: 34000 },
  { handle: 'yunapark_culture', display_name: 'Yuna Park', verified: true, follower_count: 234000 },
  { handle: 'tomh_policy', display_name: 'Tom Haverford', verified: false, follower_count: 28000 },
  { handle: 'lindav_finance', display_name: 'Linda Vasquez', verified: true, follower_count: 91000 },
];

const SEED_ARTICLES = [
  {
    handle: 'sarahchenai',
    title: 'The Hidden Cost of AI Infrastructure Nobody Talks About',
    excerpt: "We've been so focused on model capabilities that we've ignored the physical reality: cooling systems, water usage, and the small towns bearing the burden of our compute hunger.",
    categories: ['tech'],
    read_time_min: 8,
    featured: true,
    likes: 2847, bookmarks: 891, comments: 234, shares: 567,
    published_offset_hours: 2,
  },
  {
    handle: 'mwebb_sec',
    title: 'Why Every Developer Should Understand Supply Chain Attacks',
    excerpt: "The SolarWinds breach was just the beginning. Modern software supply chains are a house of cards, and most teams don't even know which cards they're standing on.",
    categories: ['tech'],
    read_time_min: 12,
    featured: false,
    likes: 1923, bookmarks: 1204, comments: 189, shares: 445,
    published_offset_hours: 4,
  },
  {
    handle: 'dianawrites',
    title: 'The New Gilded Age: Tech Wealth and Political Power',
    excerpt: "When the richest people in history can buy social platforms and reshape public discourse, we need to ask: what does democracy look like in the age of concentrated tech wealth?",
    categories: ['politics'],
    read_time_min: 15,
    featured: true,
    likes: 5621, bookmarks: 2103, comments: 892, shares: 1834,
    published_offset_hours: 6,
  },
  {
    handle: 'rajpatel_bio',
    title: 'CRISPR in the Wild: Gene Drives and Ecological Gambling',
    excerpt: "Releasing gene-edited organisms into ecosystems isn't science fiction anymore. The question isn't whether we can — it's whether the safeguards exist to prevent irreversible damage.",
    categories: ['science'],
    read_time_min: 10,
    featured: false,
    likes: 3102, bookmarks: 1567, comments: 421, shares: 789,
    published_offset_hours: 8,
  },
  {
    handle: 'jtrier',
    title: 'The Death of the Mid-Size Startup',
    excerpt: "VCs want unicorns. The market wants bootstrapped efficiency. The companies in between — the ones that used to be the backbone of tech — are disappearing.",
    categories: ['business'],
    read_time_min: 7,
    featured: false,
    likes: 4215, bookmarks: 1892, comments: 567, shares: 923,
    published_offset_hours: 12,
  },
  {
    handle: 'yunapark_culture',
    title: 'How K-Pop Rewrote the Rules of Global Entertainment',
    excerpt: "It's not just music. It's a vertically integrated content machine that makes Hollywood look like it's running on dial-up.",
    categories: ['culture'],
    read_time_min: 11,
    featured: true,
    likes: 8934, bookmarks: 3201, comments: 1245, shares: 2567,
    published_offset_hours: 24,
  },
  {
    handle: 'tomh_policy',
    title: 'The Quiet Revolution in Municipal Broadband',
    excerpt: "While Congress debates, small towns are building their own fiber networks. The results are embarrassing the telecom giants.",
    categories: ['politics'],
    read_time_min: 9,
    featured: false,
    likes: 2156, bookmarks: 987, comments: 312, shares: 534,
    published_offset_hours: 24,
  },
  {
    handle: 'lindav_finance',
    title: 'Inside the Mass Retirement Crisis Nobody Planned For',
    excerpt: "40% of Americans have less than $10,000 saved for retirement. The 401(k) experiment failed. What comes next will reshape the social contract.",
    categories: ['business'],
    read_time_min: 14,
    featured: false,
    likes: 6723, bookmarks: 4102, comments: 1567, shares: 2890,
    published_offset_hours: 48,
  },
];

async function seed() {
  console.log('Seeding Byline database...\n');

  // 1. Get category map
  const { data: cats } = await supabase.from('categories').select('id, slug');
  const catMap = new Map((cats || []).map(c => [c.slug, c.id]));
  console.log(`Found ${catMap.size} categories`);

  // 2. Insert authors
  const authorMap = new Map<string, string>();
  for (const author of SEED_AUTHORS) {
    const { data, error } = await supabase
      .from('authors')
      .upsert({
        handle: author.handle,
        display_name: author.display_name,
        verified: author.verified,
        follower_count: author.follower_count,
        x_user_id: `seed_${author.handle}`,
      }, { onConflict: 'handle' })
      .select('id')
      .single();

    if (error) {
      console.error(`  Failed: ${author.handle}`, error.message);
      continue;
    }
    authorMap.set(author.handle, data.id);
    console.log(`  Author: @${author.handle} -> ${data.id}`);
  }

  // 3. Insert articles
  for (const article of SEED_ARTICLES) {
    const authorId = authorMap.get(article.handle);
    if (!authorId) {
      console.error(`  Skipping "${article.title}" — author not found`);
      continue;
    }

    const publishedAt = new Date(Date.now() - article.published_offset_hours * 3600000).toISOString();

    const { data: art, error } = await supabase
      .from('articles')
      .insert({
        x_article_id: `seed_${article.handle}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        x_url: `https://x.com/${article.handle}/articles/seed-${article.title.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`,
        title: article.title,
        excerpt: article.excerpt,
        body_preview: article.excerpt,
        author_id: authorId,
        read_time_min: article.read_time_min,
        status: 'published',
        featured: article.featured,
        source: 'manual',
        published_at: publishedAt,
      })
      .select('id')
      .single();

    if (error) {
      console.error(`  Failed: "${article.title}"`, error.message);
      continue;
    }

    // Link categories
    for (const slug of article.categories) {
      const catId = catMap.get(slug);
      if (catId) {
        await supabase.from('article_categories').insert({
          article_id: art.id,
          category_id: catId,
        });
      }
    }

    // Seed engagement stats
    await supabase.from('article_stats').update({
      like_count: article.likes,
      bookmark_count: article.bookmarks,
      comment_count: article.comments,
      share_count: article.shares,
    }).eq('article_id', art.id);

    console.log(`  Article: "${article.title}" -> ${art.id}`);
  }

  // 4. Update author article counts
  for (const [handle, authorId] of authorMap) {
    const { count } = await supabase
      .from('articles')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', authorId)
      .eq('status', 'published');

    await supabase.from('authors').update({ article_count: count || 0 }).eq('id', authorId);
  }

  console.log('\nSeed complete.');
}

seed().catch(console.error);
