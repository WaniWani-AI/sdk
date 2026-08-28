import type { Messages } from "./en";

export const fr: Messages = {
	promptInput: {
		placeholder: "Que souhaitez-vous savoir ?",
		uploadFiles: "Importer des fichiers",
		uploadFilesUpTo: "Joindre un document, jusqu'à {limit}",
		stop: "Arrêter",
		submit: "Envoyer",
		removeAttachments: "Supprimer toutes les pièces jointes",
		removeAttachment: "Retirer la pièce jointe",
		uploading: "Envoi en cours…",
		retry: "Réessayer",
		retryUpload: "Réessayer l'envoi",
		uploadFailed: "L'envoi ne s'est pas terminé.",
		dropToAttach: "Déposez pour joindre",
		errorAccept: "{name} n'est pas un type de fichier accepté par ce chat.",
		errorTooLarge: "{name} dépasse {limit}.",
		errorTooMany: "Vous pouvez joindre jusqu'à {limit} fichiers.",
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
	chainOfThought: {
		working: "Je m'en occupe…",
		done: "Raisonnement",
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
		kindPdf: "PDF",
		kindImage: "Image",
		kindFile: "Fichier",
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
		tooltip: "Enregistrer le scénario dans Waniwani",
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
