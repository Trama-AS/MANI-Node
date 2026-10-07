// Doble de prueba mínimo para el cliente fluido de supabase-js (.from().select().eq()...),
// suficiente para probar la lógica de los repositorios Supabase*Repository sin una BD real.
function makeQueryBuilder(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    ilike: () => builder,
    upsert: () => builder,
    delete: () => builder,
    limit: () => builder,
    insert: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    // Como el PostgrestFilterBuilder real, el builder es "thenable": permite
    // `await client.from(...).delete().eq(...)` sin un .single()/.maybeSingle() final.
    then: (resolve) => resolve(result),
  };
  return builder;
}

function makeFakeSupabaseClient({ fromResult = { data: null, error: null }, auth = {} } = {}) {
  return {
    from: () => makeQueryBuilder(fromResult),
    auth,
  };
}

function makeFakeClientFactory(client) {
  return {
    isConfigured: () => true,
    getClient: () => client,
  };
}

module.exports = { makeFakeSupabaseClient, makeFakeClientFactory };
