# AEGIS BioSystems

**Autonomous Health Intelligence for Space Exploration**

*Beyond Monitoring. Towards Prevention.*

Demostración educativa para NASA Space Apps Challenge 2026. Ares Pathfinder es una misión ficticia de tránsito a Marte con 30 días de telemetría sintética de Maya Chen. Las reglas de observación son demostrativas y carecen de validación clínica.

[Publicar en GitHub y Render desde PowerShell](#publicar-la-demo-en-github-y-render-desde-powershell).

[Activar la vista orbital o volver a la clásica](#vista-orbital-y-rollback-clásico).

## Vista orbital y rollback clásico

La imagen Docker arranca en la vista orbital. El backend local arranca en la clásica si la variable no está definida. La bandera `AEGIS_ORBITAL_UI_ENABLED` acepta `1` o `true` para activar la vista orbital y `0` para volver a la clásica en ambos entornos.

- **Desarrollo local.** Añade `AEGIS_ORBITAL_UI_ENABLED=1` a `backend/.env` o ejecuta `$env:AEGIS_ORBITAL_UI_ENABLED = '1'` en la terminal de FastAPI. Reinicia FastAPI y recarga la página. Para volver a la clásica, cambia el valor a `0` y repite esos pasos. El entorno de la terminal tiene prioridad sobre `backend/.env`.
- **Render.** En el servicio, abre **Environment**, agrega `AEGIS_ORBITAL_UI_ENABLED` con valor `1` y elige **Save and deploy**. Para volver a la clásica para todos los visitantes, guarda el valor `0` de la misma forma. [Variables de entorno en Render](https://render.com/docs/configure-environment-variables).
- **En tu navegador.** Selecciona **Clásica** en **Experiencia visual** para guardar esa preferencia en el navegador. Selecciona **Automática** para volver a seguir la bandera del servidor. Para un rollback inmediato, abre la misma ruta con `?aegis-ui=classic` (o añade `&aegis-ui=classic` si ya hay parámetros). Esta opción tiene prioridad y funciona sin consultar `/api/config`. Quita el parámetro para que se vuelva a aplicar la preferencia guardada.

Si falla la consulta de configuración o la carga de la vista orbital, aparece la vista clásica con un aviso. Ambas experiencias usan la misma consola, micrófono, cola de voz y datos. Cambiar desde el selector conserva la sesión en curso. Abrir el enlace de emergencia recarga la página, por lo que tendrás que volver a iniciar el micrófono si estaba activo. En Render Free, **Save and deploy** reinicia el servicio y puede borrar el estado temporal de la demo. Usa el selector si necesitas volver a la vista clásica durante una sesión sin reiniciar el servicio.

El checkpoint local `checkpoint/pre-orbital-experience` identifica la versión anterior. La bandera y el selector permiten volver a la vista clásica sin restaurar archivos desde el checkpoint.

## Ejecutar en Windows

Requisitos: Python 3.11 o posterior, Node.js 22 o posterior y npm. Ejecuta cada bloque desde la raíz de este proyecto en una terminal PowerShell independiente.

**Terminal 1 · FastAPI**

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Set-Location backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005
```

Si Windows resuelve `python` al alias de Microsoft Store, usa `py -m venv .venv` o ejecuta el intérprete instalado con su ruta absoluta. No es necesario activar el entorno virtual.

**Terminal 2 · Vite**

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Abre [AEGIS BioSystems](http://127.0.0.1:5173/). La [documentación interactiva de FastAPI](http://127.0.0.1:8005/docs) describe los endpoints. Si el puerto 5173 está ocupado, usa `npm.cmd run dev -- --port 5187` y abre [la vista alternativa](http://127.0.0.1:5187/). Si usas Gemini Live en ese puerto, añade `http://127.0.0.1:5187` a `CORS_ORIGINS` en `backend/.env` y reinicia FastAPI.

## Configurar Gemini

1. Crea una clave para Gemini API en [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Desde la raíz, copia el ejemplo y abre la configuración local.

   ```powershell
   if (-not (Test-Path -LiteralPath .\backend\.env)) { Copy-Item .\backend\.env.example .\backend\.env }
   notepad .\backend\.env
   ```

3. Escribe la clave en `GEMINI_API_KEY` y reinicia FastAPI. El encabezado indica si el backend responde. En el panel del asistente, «Gemini sin configurar» indica que falta la clave y «Gemini configurado» indica que se ha leído una clave local. Comprueba el acceso enviando un mensaje.

El backend lee la clave exclusivamente de `backend/.env`. El modelo de texto predeterminado es `gemini-3.8-flash`. La opción `GEMINI_MODEL=auto` consulta el catálogo disponible y prueba hasta cuatro modelos de texto candidatos ante fallos de compatibilidad o del servicio. `GEMINI_LIVE_MODEL=auto` busca modelos conversacionales de Live y prueba modelos de respaldo si falla la conexión inicial. Ambas opciones aceptan un ID explícito. La cuota, los modelos y los permisos dependen del proyecto configurado en AI Studio. Si Live falla, puedes seguir usando el chat de texto.

### Companion y datos de AEGIS

El Companion tiene acceso permanente al dominio de AEGIS. Usa herramientas tipadas del backend para consultar misión, simulador, fisiología por día o rango, sueño y recomendaciones, bienestar, revisiones de alertas y actividad. Para una pregunta general usa un resumen acotado. Puede consultar observaciones cuando sean pertinentes y distinguir los registros manuales de la simulación. Sueño no tiene un diario editable independiente.

Con instrucciones claras, por texto o voz, puede crear, editar y quitar registros manuales, revisar alertas, cambiar de escenario, avanzar o reiniciar la simulación y controlar la interfaz. Si falta el registro o un valor, pide aclaración. Se ejecuta como máximo un cambio persistente por turno. Los comandos del modelo nunca dan acceso a SQL libre, archivos, PowerShell ni código ejecutable. Los valores fisiológicos son simulados por el backend.

El último contexto de chat, los resultados de herramientas pertinentes (que pueden incluir observaciones) y el audio cuando inicias voz se procesan en Google Gemini. La conversación y la transcripción quedan en memoria de la pestaña y se pueden borrar. AEGIS no guarda audio. La clave se lee exclusivamente de `backend/.env`. Los cambios y su bitácora se guardan localmente en SQLite; la bitácora contiene operación, identificador cuando corresponde, fecha y resultado. El borrado de registros es lógico. En **Actividad local** puedes deshacer creaciones o borrados recientes si el registro sigue en la versión correspondiente, o pedir el deshacer por identificador de actividad.

Prueba «Guarda ánimo 4, estrés 3 y energía 5», «Edita el estrés del registro #12 a 2» o «Quita el registro #12» (usa un ID real del historial local). **Guardado** se muestra a partir del resultado de FastAPI. Reiniciar vuelve al día 1 del escenario habitual y conserva registros y revisiones. El escenario y día activos se guardan en el navegador. Las invitaciones de bienestar están activas por defecto, aparecen como máximo una vez por día simulado y se pueden desactivar en **Configurar check-ins**. AEGIS es una demostración con datos sintéticos y no sustituye el apoyo profesional.

### Voz y diagnóstico

1. En la consola local, abre **Companion → Iniciar voz** y concede el permiso de micrófono del navegador. Pregunta algo breve y luego pide una respuesta larga. Observa **Diagnóstico de audio** y comprueba que el texto/transcripción aparece durante el turno.
2. Interrumpe hablando mientras AEGIS reproduce su respuesta. La reproducción anterior debe detenerse. Si el navegador pausa el audio, pulsa **Reanudar audio**.
3. Desconecta Internet brevemente, vuelve a conectarlo y comprueba los intentos de reconexión. Se hacen como máximo tres intentos, con esperas de 0,5, 1,5 y 3,5 segundos. Si se agotan, pulsa **Reconectar**. Se establece una sesión nueva sin reenviar audio anterior. El historial de voz de Gemini no se reanuda. **Detener voz** libera los recursos.

El error “Audio playback fell behind” sucedía cuando se programaban todos los fragmentos de golpe y el cursor se alejaba más de 12 segundos del reloj de audio. Ahora se programan hasta 180 ms por adelantado. Si se acumulan más de 1,5 s pendientes de programar o más de 128 fragmentos, se conserva hasta 750 ms del audio reciente y se descarta el excedente antiguo. Esto puede acortar una frase durante una ráfaga severa, sin reiniciar la sesión. El diagnóstico muestra duración, número de fragmentos, milisegundos descartados y reconexiones, sin datos de voz. La captura envía PCM mono de 16 bits y 16 kHz. La salida se decodifica según su tipo MIME, con 24 kHz como valor predeterminado documentado. Fuentes: [Gemini Live SDK](https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk), [formatos e interrupciones](https://ai.google.dev/gemini-api/docs/live-api/capabilities), [sesiones Live](https://ai.google.dev/gemini-api/docs/live-api/session-management) y [reloj de Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime).

### Probar Gemini de texto

Con la clave vacía en `backend/.env`, abre la consola y comprueba que los módulos siguen disponibles y que el Companion muestra **Gemini sin configurar**. Las invitaciones locales y los módulos de misión funcionan con la clave vacía.

Con una clave configurada y el backend reiniciado, ejecuta desde PowerShell:

```powershell
try {
  $body = @{ messages = @(@{ role = 'user'; text = 'Reply with OK.' }) } | ConvertTo-Json -Depth 4
  $result = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8005/api/chat' -ContentType 'application/json' -Body $body -TimeoutSec 90
  if ($result.reply -and $result.model) { 'Éxito' } else { 'Error: respuesta inesperada' }
} catch {
  if ($_.Exception.Response) { "Error HTTP $([int]$_.Exception.Response.StatusCode)" }
  else { 'Error: backend inaccesible o tiempo de espera agotado' }
}
```

Para comprobar solo la configuración, ejecuta `(Invoke-RestMethod 'http://127.0.0.1:8005/api/health').geminiStatus`. `configured` indica presencia de clave y `unconfigured` indica que falta o está vacía. Para verificar Live por separado, usa **Iniciar voz** en el navegador y haz una pregunta breve. Se requiere acceso a Internet, permiso de micrófono y un modelo Live accesible para tu proyecto.

## Demo de tres minutos

| Tiempo | Pantalla | Acción |
| --- | --- | --- |
| 0:00 | **Mission Overview** | Presenta la misión, las métricas y el escenario inicial **Sleep deficit**. Comprueba que Gemini esté configurado antes de probar chat o voz. |
| 0:25 | **Sleep Intelligence** | Selecciona el 12 de noviembre. Revisa las cinco noches consecutivas por debajo de 7 h y la recomendación asociada. |
| 0:55 | **Companion** | Pregunta «¿Cómo he dormido esta semana y qué puedo mejorar?». Compara la respuesta con el promedio y las observaciones. |
| 1:25 | **Psychological Wellness** | Registra estrés de 5 y verifica el cambio en el historial y la gráfica. |
| 1:50 | **Companion** | Pregunta «¿Qué relación observas entre mi descanso y bienestar?». El asistente puede consultar la asociación descriptiva. |
| 2:15 | **BioSystems 3D** | Pide «Abre el visor 3D, enfoca el tórax y gira a la derecha». Usa **Reset view** para restaurar la cámara. |
| 2:40 | **Voice** | Selecciona **Iniciar voz**, haz una pregunta de sueño y finaliza con **Stop voice** si tu clave admite Live. |

**Vital Monitoring** ofrece vistas de 24 h, 7 y 30 días, líneas y barras, baseline y descargas CSV/JSON. Cambia **Scenario** para recorrer el estado habitual, sueño insuficiente, alteración de horario, estrés elevado y recuperación. Las vistas, las exportaciones y Gemini consultan la misma simulación.

## Datos y pruebas

`backend/app/simulation.py` genera 30 días reproducibles con semilla fija. Para las métricas fisiológicas, el promedio de las 24 muestras coincide con el resumen diario. Para el sueño, la suma de minutos dormidos en los 24 intervalos coincide con la duración registrada. Los horarios usan un reloj de misión simulado. `backend/app/analytics.py` concentra los umbrales de sueño y las recomendaciones. Los check-ins pertenecen al escenario y al día de misión activos, con su hora real de registro. Los registros existentes se conservan en el día 30. La gráfica usa el último check-in de cada día.

Desde la raíz, con el entorno preparado:

```powershell
Push-Location backend
..\.venv\Scripts\python.exe -m pytest -q
Pop-Location
Push-Location frontend
npm.cmd run test
npm.cmd run build
Pop-Location
```

- **Pruebas automatizadas:** salud, contratos, escenarios reproducibles, consistencia, cálculo de sueño, persistencia de SQLite, validación de acciones, navegación y calendario.
- **Simulación del proveedor:** flujo de herramientas, fallback de texto, errores, WebSocket de voz, cambio de estado, cierre del cliente y liberación del micrófono. El test del visor simula el canvas y comprueba los controles de región y cámara.
- **Verificación en navegador:** panel de misión, selección de noche, detalle del calendario, cambio de vistas de signos vitales, descarga CSV, pausa guiada y renderizado y rotación en WebGL.
- **Verificación del Companion ampliado:** La suite usa respuestas simuladas para verificar cambios directos, errores del proveedor, reproducción con fragmentos tardíos y desconexiones. Se verificó que Gemini acepta la conexión real a `gemini-3.8-live` con herramientas y transcripción, sin enviar audio ni registros. La conversación con micrófono real se comprueba con los pasos anteriores.

Referencias de implementación: [Function Calling](https://ai.google.dev/gemini-api/docs/function-calling), [SDK de Gemini Live](https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk), [herramientas en Live](https://ai.google.dev/gemini-api/docs/live-api/tools) y [catálogo de modelos](https://ai.google.dev/api/models).

## Simular una situación

La barra **Simular Situación:** activa Bio-Sync, Fuga de O₂, Aislamiento Extremo o Mars Murphy’s Law. **Restaurar Nominal** vuelve a la vista estándar, detiene el ambiente y la guía y descarta el contexto pendiente anterior. El estado vive en memoria de FastAPI para la sesión de la demo. El día narrativo 142 no altera el calendario anterior.

La interfaz recibe su estado inicial por `GET /api/simulation`, el resultado de cada activación por `POST /api/simulation/{scenario}` y, con voz abierta, las actualizaciones por el mismo WebSocket Live. Los cambios en el hábitat son ficticios, versionados y deduplicados. En Zero-UI siguen accesibles las métricas principales, el estado de voz, la navegación y la restauración.

Para oír la intervención inicial, abre **Companion → Iniciar voz** y concede el micrófono. Activa una situación y espera la voz sin hablar. Si eliges la situación primero, Live recibe la última situación pendiente cuando se conecta. Gemini 3.8 Live recibe un turno de cliente completo; los modelos alternativos reciben entrada de texto en tiempo real. El ambiente es opcional y se atenúa mientras hay reproducción. La guía visual y el LFO tienen un periodo de 10 s. En Aislamiento, el proxy acústico usa el mismo micrófono autorizado y su cálculo permanece en el navegador.

En la comprobación real con el SDK de Gemini 3.8 Live, el primer audio del turno sintético Bio-Sync llegó a los **923 ms** de enviar el contexto en una conexión ya abierta. No se activó el micrófono. Esta cifra no incluye el WebSocket local, la reproducción ni el altavoz. Para una comparación de latencia de extremo a extremo, mide en el mismo equipo y navegador desde el envío de PCM hasta el primer audio reproducido, con el mismo guion y con la versión anterior y la actual. No se dispone de esa medición comparativa.

Referencias: [Gemini Live SDK](https://ai.google.dev/gemini-api/docs/live-api/get-started-sdk), [Gemini 3.8 Live](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live), [herramientas Live](https://ai.google.dev/gemini-api/docs/live-api/tools) y [AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode).

La comparación local aislada usó 5000 fragmentos PCM sintéticos de 40 ms por variante y el mismo proveedor simulado. Mediana por envío: 14,90 µs sin serialización, 16,60 µs con el bloqueo sin contención. Percentil 95: 20,90 y 23,40 µs respectivamente. La medición excluye red, contención durante cambios de situación y reproducción.

### Saludo, ánimo y guía Bio-Sync

- Abre la consola y luego **Companion** para ver «¿Cómo estás, cómo te sientes hoy?». La pregunta escrita está identificada como invitación de AEGIS hasta que exista una transcripción del saludo. **Iniciar voz** pide al navegador acceso al micrófono y solicita el saludo hablado una vez por sesión lógica de voz. Las reconexiones automáticas reutilizan ese identificador.
- En **Psychological Wellness**, elige una de las cinco burbujas y pulsa **Guardar estado de ánimo**. Energía, estrés y nota son opcionales. La nota admite hasta 600 caracteres. El historial muestra el identificador manual, con el que puedes pedir al Companion que edite o quite el registro. Las invitaciones de AEGIS no crean entradas automáticamente.
- Activa **Crisis de Pánico**. La pelota avanza y crece durante 5 s y vuelve y se reduce durante 5 s. Puedes pausar, reanudar u ocultar la guía. Con la preferencia de movimiento reducido, la guía muestra ambas fases de forma estática.
- Con voz activa, selecciona cada situación y escucha si Gemini empieza por «Anomalía detectada.». La barra muestra la narrativa prevista aunque la voz no esté conectada. Toda mención de torre se refiere a la simulación. **Restaurar Nominal** cierra la narrativa visual, detiene la guía y el ambiente, y cancela el contexto pendiente. AEGIS es una demo con datos sintéticos.

### Monitor Tierra–Marte y visualizaciones de bienestar

La geometría orbital de la demo fija la separación en 377,74 millones de km. FastAPI divide esa distancia por 299 792,458 km/s y redondea al segundo más cercano (21 min 00 s, solo de ida). Los escenarios cambian el estado ficticio del enlace y la insignia **AEGIS AUTONOMOUS OVERRIDE**. La distancia de referencia permanece fija. [Constante de velocidad de la luz, NIST](https://physics.nist.gov/cuu/Constants/Value/c.html).

El orbe del Companion toma una muestra local de la conexión del micrófono ya activa y suaviza la amplitud RMS. La salida del analizador queda desconectada. AEGIS no almacena ni transmite este índice. La constelación muestra los autorregistros con ID manual y coloca las puntuaciones opcionales omitidas en «Sin dato». Pasa el cursor o enfoca una estrella para ver sus datos, y activa la estrella con Enter o Espacio para abrir el detalle. La lista accesible ofrece la misma información.

### Narración y diagnóstico de turno

El WebSocket etiqueta el audio con sesión, turno, escenario y secuencia. Un snapshot anterior o de la misma versión se descarta antes de cancelar audio. Cuando se sustituye una narrativa en curso, el puente espera el fin del turno cancelado para atribuir audio a la siguiente. El fin de generación se distingue del fin del turno y de la reproducción local. El aviso de cierre del proveedor deja drenar lo ya recibido antes de reconectar, y las respuestas de herramientas no reinician la reproducción.

Las ráfagas de narrativa se admiten gradualmente en la cola original para evitar su regla de descarte por latencia. El búfer previo se limita a 90 s y notifica un error si se supera. El orbe usa una lectura de amplitud en el reloj de reproducción y el analizador pasivo durante la escucha. La cancelación de eco del navegador se mantiene activa. Durante la salida de una narrativa se atenúa solo el residual de baja amplitud, y se siguen respetando las interrupciones que emite Gemini y el botón **Detener voz**.

En **Diagnóstico de audio** aparecen duración pendiente, último evento de turno, identificadores abreviados e interrupciones y reconexiones. Ninguno de esos campos contiene audio ni transcripciones. Para probar eco y barge-in con el hardware local, inicia voz, activa Bio-Sync con el altavoz audible y deja terminar el turno. Repite hablando durante la narrativa y verifica que se interrumpa. Cambia luego de escenario y vuelve a nominal para comprobar que solo se cancela el audio anterior.
## Publicar la demo en GitHub y Render desde PowerShell

El [Blueprint de Render](render.yaml) crea **un Web Service Docker Free**, sin base de datos ni disco de pago. El [Dockerfile](Dockerfile) compila Vite con el lockfile y copia el resultado a la imagen de FastAPI. El servidor escucha en `0.0.0.0:$PORT` (alternativa local: `10000`). En producción, interfaz, API y voz comparten dominio: `/api/…` para HTTP y `wss://<tu-dominio>/api/live` para Gemini Live. El servidor conserva el ping de Uvicorn y el navegador usa la reconexión existente. [Web Services](https://render.com/docs/web-services) · [Docker](https://render.com/docs/docker) · [WebSockets](https://render.com/docs/websocket).

### 1. Preparar y comprobar el proyecto local

Desde la raíz, con Python 3.14, Node.js 22 y Git:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
Push-Location backend
..\.venv\Scripts\python.exe -m pytest -q
Pop-Location
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run test
npm.cmd --prefix frontend run build  # TypeScript y Vite
```

El dashboard y las situaciones funcionan sin clave. Para habilitar Gemini en local, edita `backend/.env` en tu equipo y configura `GEMINI_API_KEY`. El archivo está excluido de Git y Docker; las variables de entorno del proceso tienen prioridad. Usa los comandos habituales de desarrollo: desde `backend`, `..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005`; en otra terminal, desde la raíz, `npm.cmd --prefix frontend run dev`. Abre [Vite](http://127.0.0.1:5173/) y ejecuta `Invoke-RestMethod http://127.0.0.1:8005/api/health`.

Para verificar el modo servido por FastAPI **sin la clave local**, usa una terminal aparte. El espacio asignado a la variable anula el archivo local y se interpreta como una clave vacía:

```powershell
$env:GEMINI_API_KEY = ' '
$env:AEGIS_PUBLIC_DEMO = '1'
Set-Location backend
..\.venv\Scripts\python.exe -m app.serve
```

Abre [la versión compilada](http://localhost:10000/), prueba `/mission/dashboard` y consulta `Invoke-RestMethod http://localhost:10000/api/health`. Debe devolver `status: ok` y `geminiStatus: unconfigured`. `/api/no-existe` debe responder 404, no HTML. React navega entre módulos desde el propio dashboard. Cierra esa terminal al terminar. Con Docker Desktop iniciado también puedes ejecutar, desde la raíz, `docker build -t aegis-biosystems .` y `docker run --rm -p 127.0.0.1:10000:10000 aegis-biosystems`.

### 2. Subir el código a un repositorio privado en GitHub

Si tu copia ya tiene el commit inicial, revisa el estado y omite los comandos de inicialización y commit. Antes de agregar contenido, comprueba que las rutas privadas aparecen en la salida de `git check-ignore`. Antes de hacer commit o push, verifica que no aparecen en la salida de `git ls-files` ni en el listado del índice. Tampoco agregues manualmente grabaciones, notas reales ni credenciales.

```powershell
if (-not (Test-Path .git)) { git init -b main }
git status --short --untracked-files=all
git check-ignore -- backend/.env backend/data/wellness.sqlite3 .venv frontend/node_modules frontend/dist
git add -- .gitignore .gitattributes .dockerignore Dockerfile render.yaml README.md backend frontend
git diff --cached --name-only
git ls-files -- backend/.env backend/data .venv frontend/node_modules frontend/dist
git -c core.whitespace=-blank-at-eof diff --cached --check
git diff --cached --quiet
if ($LASTEXITCODE -eq 1) { git commit -m "Prepare AEGIS BioSystems for Render" }
git remote -v
```

- **Con GitHub CLI y sin remoto:** ejecuta `gh auth login` por el navegador si aún no has iniciado sesión, y después `gh repo create aegis-biosystems --private --source=. --remote=origin --push`. Comprueba con `gh repo view --json visibility,url` que la visibilidad sea `PRIVATE`.
- **Desde GitHub web:** en [New repository](https://github.com/new) crea `aegis-biosystems`, elige **Private** y deja el repositorio vacío (sin README, licencia ni .gitignore). Copia su URL HTTPS y ejecuta `git remote add origin https://github.com/TU_USUARIO/aegis-biosystems.git` y `git push -u origin main`. Git Credential Manager puede abrir el navegador para autenticarse. Si ya existe `origin`, comprueba que corresponde a este repositorio privado antes de hacer push; no lo reemplaces por defecto.

### 3. Crear el servicio Free en Render

1. En el [panel de Render](https://dashboard.render.com/) conecta GitHub y concede acceso al repositorio privado `aegis-biosystems`. Sigue [Your First Render Deploy](https://render.com/docs/your-first-deploy) para conectar la cuenta.
2. Elige **New → Blueprint**, selecciona el repositorio y la rama `main`. Usa `render.yaml` de la raíz. Antes de aplicar, comprueba que se creará **un solo Web Service**, con runtime **Docker**, plan **Free**, Dockerfile `./Dockerfile` y health check `/api/health`. [Referencia del Blueprint](https://render.com/docs/blueprint-spec).
3. Si quieres activar Companion, introduce `GEMINI_API_KEY` cuando Render pida el secreto (`sync: false`). Si quieres publicar sin IA y el formulario exige un valor, crea **New → Web Service** con los mismos parámetros anteriores, sin añadir la variable. Puedes incorporarla luego en el servicio: **Environment → Add Environment Variable → Save and deploy**. No añadas la clave al Dockerfile ni al repositorio. `GEMINI_MODEL` y `GEMINI_LIVE_MODEL` son opcionales; `PORT` y `RENDER_EXTERNAL_URL` los proporciona Render. Para un dominio personalizado, añade su origen HTTPS exacto a `CORS_ORIGINS`. [Variables y secretos](https://render.com/docs/configure-environment-variables) · [Variables de Render](https://render.com/docs/environment-variables).
4. Aplica el Blueprint y observa **Events** y **Logs** hasta que quede **Live**. El [health check](https://render.com/docs/health-checks) no contacta a Gemini: comprueba la respuesta del servidor y solo indica si hay una clave configurada. `configured` no implica que la clave sea válida ni que tenga cuota.

### 4. Comprobar la web publicada

1. Abre la URL HTTPS `onrender.com` de **tu** servicio. Consulta `/api/health`; abre el Dashboard, signos vitales, sueño y bienestar; recarga una ruta como `/mission/dashboard`. Revisa que un archivo inexistente en `/assets/` y una ruta desconocida de `/api/` devuelvan 404.
2. Con la clave configurada, abre Companion y envía una pregunta de prueba. Luego pulsa **Iniciar voz**, permite el micrófono y haz otra pregunta. En **DevTools → Network → WS** comprueba `wss://<tu-dominio>/api/live` y el estado `101`; escucha la respuesta. Activa **Crisis de Pánico** y verifica que se oye «Anomalía detectada», además de aparecer el texto. Restaura **Nominal** y prueba **Detener voz**.
3. Abre una ventana privada y comprueba que no aparecen las notas sintéticas ni la situación activada en la primera ventana. No uses información personal para la prueba.

Si falla el **build**, revisa el primer error en Logs (lockfile, compilación de TypeScript o etapa de Python). Si falla el **health check**, revisa `/api/health`, el arranque y `PORT`. Si la clave figura como **unconfigured**, revisa la variable del servicio; si consta como configurada y Gemini devuelve error, revisa permisos del modelo, autenticación y cuota. Si falla **WebSocket**, revisa HTTPS/WSS, permiso de micrófono y origen exacto (403 al conectar suele indicar origen rechazado o cookie de sesión ausente; vuelve a cargar la web). Un redeploy corta la conexión y el cliente reintenta un número limitado de veces; si se agota, pulsa **Reconectar**. Si ves un 404 al recargar una ruta SPA, comprueba que el build incluyó `dist/index.html`. En el arranque en frío espera a que el servicio vuelva a responder antes de reintentar la voz.

**Privacidad y límites.** La demo pública usa una cookie HttpOnly para aislar las visitas, una base SQLite temporal por visita para bienestar y actividad, y los escenarios se guardan en memoria por visita. No usa la base local de desarrollo. El estado puede perderse tras una hora de inactividad de esa visita, al reiniciar, al suspenderse o al redesplegar. Una persona con acceso al mismo perfil del navegador comparte esa visita; no hay cuentas ni recuperación de datos. Usa solo datos ficticios; el texto y el micrófono utilizados con Companion se envían a Gemini para responder. No se guardan grabaciones ni conversaciones completas en logs. El chat tiene límites por visita y por servicio; la voz limita conexiones simultáneas, frecuencia y duración. Son topes de una demo, no un sistema de autenticación ni una garantía sobre cuotas o cobros de Gemini.

**Plan Free de Render.** A 14 de noviembre de 2026, la [documentación oficial](https://render.com/docs/free) indica suspensión tras **15 minutos sin tráfico entrante**, reactivación de alrededor de un minuto, **750 horas de instancia al mes por workspace** y posibles reinicios. La suspensión, el reinicio o el redeploy eliminan los cambios del sistema de archivos local. Render también mide ancho de banda y minutos de build. Esta demo no crea una base externa: Free Postgres **caduca a los 30 días** y no ofrece respaldo; no sirve como almacenamiento duradero. Si en el futuro necesitas persistencia, habrá que elegir un servicio y revisar su [precio oficial](https://render.com/pricing) antes de contratarlo.
