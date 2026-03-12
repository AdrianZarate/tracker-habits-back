# Dependencias del proyecto Habit Tracker

---

## Dependencias de producción

### NestJS — Core

| Paquete                    | Descripción                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@nestjs/common`           | Módulo principal: decoradores (`@Controller`, `@Injectable`, `@Get`…), pipes, guards, interceptores y más.      |
| `@nestjs/core`             | Núcleo del framework NestJS; gestiona el ciclo de vida de la aplicación y la inyección de dependencias.         |
| `@nestjs/platform-express` | Adaptador que conecta NestJS con el servidor HTTP de Express.                                                   |
| `reflect-metadata`         | Habilita los metadatos de TypeScript en tiempo de ejecución, requerido por el sistema de decoradores de NestJS. |
| `rxjs`                     | Librería de programación reactiva; requerida internamente por NestJS para flujos de datos asíncronos.           |

---

### Autenticación — Passport + JWT

> Estas dependencias trabajan en conjunto para implementar autenticación basada en JSON Web Tokens.

| Paquete            | Descripción                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `@nestjs/passport` | Integración de Passport con NestJS; expone guards y helpers para aplicar estrategias de autenticación. |
| `passport`         | Middleware de autenticación para Node.js; base sobre la que se construyen las estrategias.             |
| `passport-jwt`     | Estrategia de Passport para validar tokens JWT en cada petición.                                       |
| `@nestjs/jwt`      | Módulo de NestJS para firmar y verificar JSON Web Tokens.                                              |

> **devDependency complementaria:** `@types/passport-jwt` — Tipos de TypeScript para `passport-jwt`.

---

### Base de datos — MongoDB / Mongoose

> Estas dependencias trabajan en conjunto para conectar y modelar datos en MongoDB.

| Paquete            | Descripción                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- |
| `@nestjs/mongoose` | Integración oficial de Mongoose con NestJS; permite definir esquemas con decoradores. |
| `mongoose`         | ODM (Object Document Mapper) para MongoDB; gestiona modelos, esquemas y consultas.    |

---

### Configuración y validación del entorno

> Se usan juntas para cargar y validar las variables de entorno de forma segura.

| Paquete          | Descripción                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `@nestjs/config` | Módulo de NestJS para gestionar la configuración de la aplicación y variables de entorno (`.env`).             |
| `joi`            | Validación del esquema de variables de entorno; garantiza que la app no arranque con configuración incorrecta. |

---

### Validación y transformación de DTOs

> Estas dos librerías trabajan en conjunto para validar y transformar los datos de entrada.

| Paquete             | Descripción                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `class-validator`   | Decoradores para validar propiedades de clases/DTOs (e.g., `@IsString()`, `@IsEmail()`).          |
| `class-transformer` | Transforma objetos planos en instancias de clases (necesario para que `ValidationPipe` funcione). |

---

### Documentación de la API

| Paquete           | Descripción                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `@nestjs/swagger` | Genera documentación interactiva de la API (Swagger / OpenAPI) a partir de los decoradores del código. |

---

### Utilidades

| Paquete                | Descripción                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `bcrypt`               | Hashing seguro de contraseñas con sal; se usa para guardar y comparar contraseñas de usuarios. |
| `slugify`              | Convierte cadenas de texto en slugs URL-friendly (e.g., `"Mi Hábito"` → `"mi-habito"`).        |
| `@nestjs/mapped-types` | Utilidades para transformar tipos de DTOs (e.g., `PartialType`, `PickType`, `OmitType`).       |

---

## Dependencias de desarrollo

### Testing

> Conjunto completo para pruebas unitarias y end-to-end.

| Paquete            | Descripción                                                                       |
| ------------------ | --------------------------------------------------------------------------------- |
| `jest`             | Framework de testing principal.                                                   |
| `ts-jest`          | Transformador que permite ejecutar tests escritos en TypeScript con Jest.         |
| `@types/jest`      | Tipos de TypeScript para Jest (`describe`, `it`, `expect`…).                      |
| `@nestjs/testing`  | Utilidades de NestJS para crear módulos de prueba aislados.                       |
| `supertest`        | Librería para hacer peticiones HTTP en tests end-to-end sin levantar el servidor. |
| `@types/supertest` | Tipos de TypeScript para `supertest`.                                             |

---

### Linting y formato de código

> Trabajan juntas para mantener un estilo de código consistente.

| Paquete                  | Descripción                                                                     |
| ------------------------ | ------------------------------------------------------------------------------- |
| `eslint`                 | Linter principal para detectar errores y malas prácticas en el código.          |
| `typescript-eslint`      | Plugin y parser que permite a ESLint analizar código TypeScript.                |
| `@eslint/js`             | Reglas de ESLint recomendadas para JavaScript.                                  |
| `@eslint/eslintrc`       | Utilidad de compatibilidad para la nueva configuración plana de ESLint.         |
| `globals`                | Define variables globales de entornos (browser, node…) para ESLint.             |
| `prettier`               | Formateador de código para mantener estilo uniforme.                            |
| `eslint-config-prettier` | Desactiva las reglas de ESLint que entran en conflicto con Prettier.            |
| `eslint-plugin-prettier` | Ejecuta Prettier como una regla de ESLint para reportar diferencias de formato. |

---

### TypeScript y compilación

> Conjunto necesario para compilar y ejecutar TypeScript en el proyecto.

| Paquete              | Descripción                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `typescript`         | Compilador de TypeScript.                                                                 |
| `ts-node`            | Ejecuta archivos TypeScript directamente sin compilar previamente (usado en desarrollo).  |
| `ts-loader`          | Loader de Webpack para compilar TypeScript (usado en el proceso de build de NestJS).      |
| `tsconfig-paths`     | Resuelve los alias de rutas definidos en `tsconfig.json` en tiempo de ejecución.          |
| `source-map-support` | Mapea los errores del código compilado al código TypeScript original en los stack traces. |

---

### CLI y scaffolding de NestJS

| Paquete              | Descripción                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `@nestjs/cli`        | CLI oficial de NestJS para generar recursos, compilar y correr la aplicación.            |
| `@nestjs/schematics` | Esquemas de generación de código usados por el CLI (módulos, controladores, servicios…). |

---

### Tipos de TypeScript adicionales

| Paquete               | Descripción                                                                      |
| --------------------- | -------------------------------------------------------------------------------- |
| `@types/bcrypt`       | Tipos de TypeScript para la librería `bcrypt`.                                   |
| `@types/express`      | Tipos de TypeScript para Express (necesario al extender `Request`, por ejemplo). |
| `@types/node`         | Tipos de TypeScript para las APIs de Node.js (`Buffer`, `process`, `fs`…).       |
| `@types/passport-jwt` | Tipos de TypeScript para la estrategia `passport-jwt`.                           |
