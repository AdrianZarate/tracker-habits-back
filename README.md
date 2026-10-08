<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

# 📊 Habit Tracker API

> **Guía vigente:** [Configuración y autenticación Google](docs/configuration.md) es la referencia actual. Los ejemplos de registro/login con contraseña de este README son antiguos; la API usa exclusivamente Google.

API RESTful para el seguimiento y gestión de hábitos personales, desarrollada con NestJS, MongoDB y JWT para autenticación.

## ✨ Características

- 🔐 Autenticación JWT con registro y login de usuarios
- ✅ Crear y gestionar hábitos personalizados
- 📝 Marcar hábitos como completados/incompletos
- 📊 Visualizar registros (logs) de hábitos por fecha
- 🔒 Endpoints protegidos con guards de autenticación
- 📖 Documentación interactiva con Swagger
- 🐳 Configuración Docker para MongoDB
- 🌐 CORS configurado para múltiples orígenes

## 📋 Requisitos Previos

- [Node.js](https://nodejs.org/) (v18 o superior)
- [Yarn](https://yarnpkg.com/) o npm
- [Docker](https://www.docker.com/) y Docker Compose (para MongoDB)
- [MongoDB](https://www.mongodb.com/) (si no usas Docker)

## 🚀 Instalación

1. **Clonar el repositorio**

   ```bash
   git clone <url-del-repositorio>
   cd habit-tracker
   ```

2. **Instalar dependencias**

   ```bash
   yarn install
   # o
   npm install
   ```

3. **Configurar variables de entorno**

   Crear un archivo `.env` en la raíz del proyecto con las siguientes variables:

   ```env
   # Entorno
   NODE_ENV=development

   # Puerto del servidor
   PORT=3000

   # MongoDB
   MONGODB=mongodb://localhost:27017/habit-tracker

   # JWT Secret
   JWT_SECRET=tu_clave_secreta_super_segura_aqui
   ```

4. **Iniciar MongoDB con Docker**
   ```bash
   docker-compose up -d
   ```

## 🏃‍♂️ Ejecución del Proyecto

### Modo Desarrollo

```bash
yarn start:dev
```

El servidor se iniciará en `http://localhost:3000` (o el puerto configurado en `.env`)

### Modo Producción

```bash
# Construir
yarn build

# Ejecutar
yarn start:prod
```

### Modo Debug

```bash
yarn start:debug
```

## 🐳 Docker

### Iniciar MongoDB

```bash
docker-compose up -d
```

### Detener MongoDB

```bash
docker-compose down
```

### Ver logs

```bash
docker-compose logs -f
```

## 📖 Documentación de la API (Swagger)

Una vez iniciado el servidor, accede a la documentación interactiva en:

```
http://localhost:3000/api
```

### Autenticación en Swagger

1. Usa el endpoint `/auth/login` o `/auth/register` para obtener un token JWT
2. Copia el token de la respuesta
3. Haz clic en el botón **"Authorize" 🔓** en la parte superior derecha
4. Pega el token (sin incluir la palabra "Bearer")
5. Clic en "Authorize" y luego "Close"
6. Ahora puedes probar todos los endpoints protegidos

## 📁 Estructura del Proyecto

```
habit-tracker/
├── src/
│   ├── auth/                    # Módulo de autenticación
│   │   ├── decorators/          # Decoradores personalizados (@Auth, @GetUser)
│   │   ├── dto/                 # DTOs para login y registro
│   │   ├── entities/            # Entidad de usuario
│   │   ├── guards/              # Guards de autorización por roles
│   │   ├── interface/           # Interfaces
│   │   ├── strategies/          # Estrategia JWT de Passport
│   │   └── auth.service.ts      # Lógica de autenticación
│   ├── common/                  # Recursos compartidos
│   │   └── pipes/               # Pipes personalizados (ParseMongoId)
│   ├── config/                  # Configuración de variables de entorno
│   ├── habits/                  # Módulo de hábitos
│   │   ├── dto/                 # DTOs para hábitos y logs
│   │   ├── entities/            # Entidades (Habit, HabitUser, HabitLog)
│   │   └── habits.service.ts    # Lógica de negocio de hábitos
│   ├── app.module.ts            # Módulo principal
│   └── main.ts                  # Punto de entrada de la aplicación
├── test/                        # Tests e2e
├── mongo/                       # Datos persistentes de MongoDB (Docker)
├── docker-compose.yaml          # Configuración de Docker
└── package.json
```

## 🛠️ Tecnologías Utilizadas

- **Framework**: [NestJS](https://nestjs.com/) v11
- **Base de datos**: [MongoDB](https://www.mongodb.com/) con [Mongoose](https://mongoosejs.com/)
- **Autenticación**: JWT con [Passport](http://www.passportjs.org/)
- **Documentación**: [Swagger](https://swagger.io/) / OpenAPI
- **Validación**: [class-validator](https://github.com/typestack/class-validator) y [class-transformer](https://github.com/typestack/class-transformer)
- **Encriptación**: [bcrypt](https://www.npmjs.com/package/bcrypt)
- **Testing**: [Jest](https://jestjs.io/)

## 🔑 Autenticación y Autorización

La API utiliza JSON Web Tokens (JWT) para autenticación. Todos los endpoints de hábitos requieren autenticación.

### Flujo de autenticación:

1. **Registro**: `POST /auth/register`

   ```json
   {
     "email": "usuario@example.com",
     "password": "password123",
     "fullName": "Nombre Completo"
   }
   ```

2. **Login**: `POST /auth/login`

   ```json
   {
     "email": "usuario@example.com",
     "password": "password123"
   }
   ```

   Respuesta:

   ```json
   {
     "user": { ... },
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   }
   ```

3. **Uso del token**: Incluye el token en el header `Authorization`:
   ```
   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

## 📌 Endpoints Principales

### Autenticación

- `POST /auth/register` - Registrar nuevo usuario
- `POST /auth/login` - Iniciar sesión
- `GET /auth/check-status` - Verificar estado de autenticación (requiere token)

### Hábitos (todos requieren autenticación)

- `POST /habits` - Crear nuevo hábito
- `GET /habits` - Obtener todos los hábitos del usuario
- `PATCH /habits/:habitId` - Actualizar un hábito
- `POST /habits/:habitId/complete` - Marcar hábito como completado
- `DELETE /habits/:habitId/incomplete` - Eliminar registro de completado
- `GET /habits/:habitId/logs` - Obtener logs de un hábito específico
- `GET /habits/logs` - Obtener todos los logs del usuario

## 🌐 CORS

El servidor está configurado para aceptar peticiones desde:

- `https://tracker-habits.alexadrian.dev`
- `https://dynamic-nasturtium-c7a358.netlify.app`
- `http://localhost:5173`

Para modificar los orígenes permitidos, edita el array `origin` en [src/main.ts](src/main.ts).

## 🤝 Contribución

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto es privado y está bajo licencia UNLICENSED.

## 👨‍💻 Soporte

Para preguntas o problemas, abre un issue en el repositorio.

---

Desarrollado con ❤️ usando [NestJS](https://nestjs.com/)
