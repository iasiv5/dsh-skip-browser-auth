export const name = 'dsh-skip-browser-auth-rpc-probe'
export const inject = ['connection']

export function apply(ctx) {
  const disposeRpc = ctx.connection.rpc.handle('/dsh-sba-rpc-probe', async (endpoint, payload) => ({
    ok: true,
    value: { endpoint, payload },
  }))
  const disposeFetch = ctx.connection.fetch.register({
    path: '/api/dsh-sba-fetch-probe',
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: async (request) => new Response(`echo:${await request.text()}`, { status: 201 }),
  })
  ctx.effect(() => async () => {
    await disposeRpc()
    await disposeFetch()
  }, 'dsh-skip-browser-auth rpc/fetch probe')
}
