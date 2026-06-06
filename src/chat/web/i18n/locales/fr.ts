import type { Messages } from "./en";

export const fr: Messages = {
	promptInput: {
		placeholder: "Que souhaitez-vous savoir ?",
		uploadFiles: "Importer des fichiers",
		stop: "Arrêter",
		submit: "Envoyer",
		removeAttachments: "Supprimer toutes les pièces jointes",
	},
	workingIndicator: {
		default: "Un instant…",
	},
	reasoning: {
		thinking: "Réflexion…",
		thoughtBrief: "Réflexion pendant quelques secondes",
		thoughtForSeconds: (count: number) =>
			`Réflexion pendant ${count} seconde${count === 1 ? "" : "s"}`,
	},
	tool: {
		copy: "Copier",
		copied: "Copié",
		request: "Requête",
		response: "Réponse",
		error: "Erreur",
	},
	attachments: {
		attachmentFallback: "pièce jointe",
		fileFallback: "fichier",
	},
	threadMenu: {
		newChat: "Nouvelle conversation",
		threadHistory: "Historique",
		deleteThread: "Supprimer la conversation",
		noPreviousChats: "Aucune conversation précédente.",
		hiddenThreads: (count: number) =>
			`${count} conversation${count === 1 ? "" : "s"} plus ancienne${count === 1 ? "" : "s"} masquée${count === 1 ? "" : "s"}`,
	},
	chatQueue: {
		attachmentFallback: "(pièce jointe)",
		removeFromQueue: "Retirer de la file",
		queued: (count: number) => `${count} en attente`,
	},
	poweredBy: {
		label: "Agent IA propulsé par",
	},
	aiDisclaimer: {
		default: "peut faire des erreurs",
	},
	exportSession: {
		saving: "enregistrement...",
		saved: "enregistré",
		error: "erreur",
		export: "exporter",
		tooltip: "Enregistrer le scénario dans WaniWani",
	},
	widgetErrorBoundary: {
		failedToLoad: "Échec du chargement du widget",
		retry: "Réessayer",
	},
	launcher: {
		prompt: "Posez votre question…",
		open: "Ouvrir le chat",
		close: "Fermer le chat",
		minimize: "Réduire",
	},
};
