import type { Messages } from "./en";

export const es: Messages = {
	promptInput: {
		placeholder: "¿Qué te gustaría saber?",
		uploadFiles: "Subir archivos",
		uploadFilesUpTo: "Subir un documento, hasta {limit}",
		uploadFilesUpToWithPages:
			"Subir un documento, hasta {limit} y {pages} páginas",
		stop: "Detener",
		submit: "Enviar",
		removeAttachments: "Eliminar todos los archivos adjuntos",
		removeAttachment: "Quitar archivo",
		uploading: "Subiendo…",
		retry: "Reintentar",
		retryUpload: "Reintentar la subida",
		uploadFailed: "La subida no se completó.",
		dropToAttach: "Suelta para adjuntar",
		errorAccept: "{name} no es un tipo de archivo que acepte este chat.",
		errorTooLarge: "{name} supera {limit}.",
		errorTooMany: "Puedes adjuntar hasta {limit} archivos.",
	},
	workingIndicator: {
		default: "Un momento…",
	},
	reasoning: {
		thinking: "Pensando…",
		thoughtBrief: "Pensado durante unos segundos",
		thoughtForSeconds: (count: number) =>
			`Pensado durante ${count} segundo${count === 1 ? "" : "s"}`,
	},
	chainOfThought: {
		working: "Estoy en ello…",
		done: "Razonamiento",
	},
	tool: {
		copy: "Copiar",
		copied: "Copiado",
		request: "Solicitud",
		response: "Respuesta",
		error: "Error",
	},
	attachments: {
		attachmentFallback: "adjunto",
		kindPdf: "PDF",
		kindImage: "Imagen",
		kindFile: "Archivo",
		fileFallback: "archivo",
	},
	threadMenu: {
		newChat: "Nueva conversación",
		threadHistory: "Historial",
		deleteThread: "Eliminar conversación",
		noPreviousChats: "Aún no hay conversaciones anteriores.",
		hiddenThreads: (count: number) =>
			`${count} conversación${count === 1 ? "" : "es"} anterior${count === 1 ? "" : "es"} oculta${count === 1 ? "" : "s"}`,
	},
	chatQueue: {
		attachmentFallback: "(adjunto)",
		removeFromQueue: "Quitar de la cola",
		queued: (count: number) => `${count} en cola`,
	},
	poweredBy: {
		label: "Agente IA con tecnología de",
	},
	aiDisclaimer: {
		default: "puede cometer errores",
	},
	exportSession: {
		saving: "guardando...",
		saved: "guardado",
		error: "error",
		export: "exportar",
		tooltip: "Guardar escenario en Waniwani",
	},
	widgetErrorBoundary: {
		failedToLoad: "No se pudo cargar el widget",
		retry: "Reintentar",
	},
	launcher: {
		prompt: "Pregunta lo que quieras…",
		open: "Abrir chat",
		close: "Cerrar chat",
		minimize: "Minimizar",
	},
};
