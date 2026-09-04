/**
 * Doble de `$app/environment` para la suite.
 *
 * SvelteKit lo inyecta en tiempo de compilación; fuera de su plugin no existe.
 * `browser: true` porque lo que se prueba son módulos que solo hacen algo en
 * el navegador —el cliente de socket comprueba esta bandera antes de conectar—
 * y con `false` no se ejecutaría nada de lo que interesa.
 */
export const browser = true
export const dev = true
export const building = false
export const version = 'test'
