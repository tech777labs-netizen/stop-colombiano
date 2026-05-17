# Stop Colombiano

MVP web para jugar **Stop** en familia desde varios dispositivos.

## Funcionalidades

- Crear sala con código corto.
- Unirse desde otro celular/computador con el código o link compartido.
- Rondas con letra aleatoria.
- Categorías colombianas por defecto: nombre, apellido, ciudad/lugar, animal, comida, cosa y color.
- Botón **STOP** para cerrar ronda.
- Puntaje automático: única 100, repetida 50, vacía 0.
- Marcador acumulado.

## Stack

- Vite + JavaScript vanilla.
- Netlify Functions.
- Netlify Blobs como almacenamiento temporal/simple para salas.

No requiere Supabase para este MVP. Si más adelante se necesita historial, usuarios, rankings o muchas salas concurrentes, se puede migrar a Supabase.

## Desarrollo local

```bash
npm install
npm test
npm run build
npx netlify dev
```

## Deploy

Configurado para Netlify con `netlify.toml`.
