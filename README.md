# Habit Tracker API

API de hábitos personales con NestJS, MongoDB y autenticación Google.
Permite crear/reactivar hábitos, registrar el día completado y consultar historial
según el calendario de cada cuenta. Este README guía el desarrollo local;
**no declara el proyecto listo para producción ni cubre despliegue público**.

## Inicio local

Necesitas Node.js, Yarn Classic **1.x**, MongoDB y, si usas el servicio incluido,
Docker con Compose. Ejecuta los comandos de Yarn desde el directorio `api/`.

1. Instala respetando el lockfile y sin scripts de instalación:

   ```sh
   yarn install --frozen-lockfile --ignore-scripts
   ```

2. Proporciona las variables de la tabla siguiente mediante el entorno del
   proceso o un `.env` privado en `api/`. No publiques credenciales ni archivos
   de entorno; conserva los valores explícitos que ya tengas configurados.
3. Si necesitas MongoDB local, inicia **solo** el servicio `db`:

   ```sh
   # Desde la raíz del workspace (contiene api/ y frontend/):
   docker compose -f api/docker-compose.yaml up -d db
   # Alternativa desde api/:
   docker compose up -d db
   ```

4. Con la configuración válida y MongoDB disponible, inicia la API:

   ```sh
   yarn start:dev
   ```

Por defecto escucha en `http://localhost:3000`; Swagger está en `/api`.
Si defines `PORT`, usa ese puerto tanto en las URLs como en el frontend.
Configura `VITE_API_URL` con la URL base de esta API (por ejemplo,
`http://localhost:3000`, sin `/api`). Para Google en el cliente y sus orígenes
OAuth autorizados, sigue el [README del frontend](../frontend/README.md).

## Configuración del servidor

| Variable | Contrato |
| --- | --- |
| `MONGODB` | Obligatoria: URI no vacía. La API selecciona la base `habit-tracker`. |
| `GOOGLE_CLIENT_ID` | Obligatoria: ID de cliente Google cuya audiencia se valida. |
| `JWT_SECRET` | Obligatoria: secreto privado fuerte, no vacío ni solo espacios; sin valor por defecto. |
| `PORT` | Entero entre 1 y 65535; **3000 solo si se omite**. El valor explícito se conserva; valores inválidos impiden arrancar. |
| `NODE_ENV` | `development` si se omite. |

Nest valida al arrancar; bootstrap, MongoDB y autenticación consumen las claves
mayúsculas mediante `ConfigService`, sin alias antiguos ni secreto de respaldo.
El entorno del proceso tiene prioridad sobre `.env`. Consulta los detalles en
[Configuración y autenticación](docs/configuration.md).

## Autenticación: solo Google

1. Obtén en el cliente un **ID token de Google** para `GOOGLE_CLIENT_ID`.
2. Envía `POST /auth/google` con este cuerpo:

   ```json
   { "idToken": "<ID token de Google>", "timeZone": "Europe/Madrid" }
   ```

3. Usa el `token` devuelto (JWT de la API, duración **2 horas**) en
   `Authorization: Bearer <token>`. No uses el ID token como JWT de la API.
   En Swagger, autoriza con ese JWT mediante el esquema `JWT-auth`.

`GET /auth/check-status` requiere Bearer JWT y devuelve estado público y token.
No existen endpoints de registro/login con contraseña.
`timeZone` es opcional: sin zona previa, omitirlo asigna UTC; un valor IANA
inválido devuelve 400. La primera asignación se persiste, también en cuentas antiguas;
posteriores accesos no la reemplazan. Mientras una cuenta antigua no tenga zona,
las lecturas usan UTC sin escribirla. **El historial nunca se desplaza ni reescribe**.

## Hábitos y calendario

Todas las rutas de hábitos requieren JWT. La identidad autenticada determina
las asociaciones y registros: no se acepta un usuario elegido por el cliente.
Los parámetros `:habitId` deben ser IDs Mongo válidos; si no, devuelven 400.

| Ruta | Comportamiento |
| --- | --- |
| `POST /habits` | Crea/reutiliza el hábito global por título y activa la asociación de la cuenta. |
| `GET /habits` | Lista las asociaciones activas de la cuenta. |
| `GET /habits/:habitId` | Detalle propio `{ habitId, title, slug, active }`, incluso inactivo; ausente/ajeno devuelve 404. |
| `PATCH /habits/:habitId` | Desactiva la asociación propia, incluso si ya está inactiva; ausente/ajena devuelve 404. No edita el título. |
| `POST /habits/:habitId/complete` | Requiere asociación propia activa; registra hoy de forma idempotente. |
| `DELETE /habits/:habitId/incomplete` | Borra solo el registro propio de hoy, sin exigir asociación activa; ajeno/ausente devuelve **200**, `deletedCount: 0` (no-op). |
| `GET /habits/:habitId/logs` | Historial propio, incluso inactivo; ajeno/ausente devuelve `[]`, no 404. |
| `GET /habits/logs` | Todos los registros propios, incluidos inactivos, del más reciente al más antiguo; sin filtro mensual. |

Completar/deshacer usa el día de la zona persistida de la cuenta, no la del
servidor o dispositivo. En `/habits/:habitId/logs`, `startDate` y `endDate` son
fechas gregorianas estrictas `YYYY-MM-DD` (años 0001–9999), inclusivas.
Cada límite omitido usa el inicio/fin del **mes actual de la cuenta**.
Fechas imposibles, vacías, timestamps y rangos invertidos devuelven 400.
Los registros históricos conservan sus anclas UTC originales como etiquetas de
calendario. Véanse [Calendario](docs/calendar-contract.md) y
[Contrato de hábitos](docs/habits-contract.md) para respuestas y casos límite.

## Comprobaciones y límites

Desde `api/`, sin usar `yarn lint` (incluye `--fix`):

```sh
yarn test --runInBand
yarn test:e2e --runInBand
yarn eslint "{src,apps,libs,test}/**/*.ts"
yarn build
```

La referencia de cobertura es de 126 pruebas unitarias y 38 HTTP aisladas;
esta limpieza documental no vuelve a ejecutarlas. Las unitarias usan dobles de
base de datos/autenticación; las HTTP ejercitan guards, validación y servicios
reales con modelos simulados. No prueban OAuth Google en vivo ni persistencia,
agregaciones o índices en MongoDB real. Consulta
[Verificación HTTP y límites](docs/http-verification.md). No se afirma validación
de servicios externos ni preparación para producción.
