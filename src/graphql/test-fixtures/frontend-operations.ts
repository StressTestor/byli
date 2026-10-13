// Every GraphQL operation the site sends, copied verbatim from
// src/hooks/api.ts and src/components/feed/home-feed.tsx. Imported by tests
// only. contract.test.ts fails if a source file drifts from these strings.

export const FE_FEED = `
        query Feed($first: Int, $after: String, $category: String, $sort: FeedSort, $search: String) {
          articles(first: $first, after: $after, category: $category, sort: $sort, search: $search) {
            edges {
              node {
                id
                title
                excerpt
                xUrl
                readTimeMin
                featured
                publishedAt
                viewerHasLiked
                viewerHasBookmarked
                author {
                  handle
                  displayName
                  avatarUrl
                  verified
                }
                categories { slug label }
                stats { likeCount bookmarkCount commentCount shareCount avgRating }
              }
              cursor
              score
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;

export const FE_ARTICLE = `
          query Article($id: UUID!) {
            article(id: $id) {
              id title excerpt bodyPreview xUrl readTimeMin featured publishedAt
              viewerHasLiked viewerHasBookmarked viewerRating
              author { id handle displayName avatarUrl bio verified claimed followerCount articleCount }
              categories { slug label }
              stats { likeCount bookmarkCount commentCount shareCount ratingCount avgRating }
            }
          }
        `;

export const FE_LIKE = `mutation($id: UUID!) { likeArticle(articleId: $id) { id stats { likeCount } viewerHasLiked } }`;
export const FE_UNLIKE = `mutation($id: UUID!) { unlikeArticle(articleId: $id) { id stats { likeCount } viewerHasLiked } }`;
export const FE_BOOKMARK = `mutation($id: UUID!) { bookmarkArticle(articleId: $id) { id stats { bookmarkCount } viewerHasBookmarked } }`;
export const FE_REMOVE_BOOKMARK = `mutation($id: UUID!) { removeBookmark(articleId: $id) { id stats { bookmarkCount } viewerHasBookmarked } }`;
export const FE_RATE = `mutation($id: UUID!, $score: Int!) { rateArticle(articleId: $id, score: $score) { id stats { avgRating ratingCount } viewerRating } }`;

export const FE_SUBMIT = `
        mutation Submit($input: SubmitArticleInput!) {
          submitArticle(input: $input) { id url status createdAt }
        }
      `;

export const FE_HOME_FEED = `
  query Feed($first: Int, $after: String, $category: String, $sort: FeedSort) {
    articles(first: $first, after: $after, category: $category, sort: $sort) {
      edges { node {
        id title excerpt coverImageUrl readTimeMin featured publishedAt
        author { handle displayName verified }
        stats { likeCount bookmarkCount }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const API_TS_OPERATIONS = [FE_FEED, FE_ARTICLE, FE_LIKE, FE_UNLIKE, FE_BOOKMARK, FE_REMOVE_BOOKMARK, FE_RATE, FE_SUBMIT];
export const HOME_FEED_OPERATIONS = [FE_HOME_FEED];
export const ALL_FRONTEND_OPERATIONS = [...API_TS_OPERATIONS, ...HOME_FEED_OPERATIONS];
