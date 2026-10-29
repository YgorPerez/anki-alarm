import { translator, type Locale } from "@app/core";

const messages = {
  "pt-BR": {
    account: "Conta",
    pitch: "Entre com o Google para sincronizar seus baralhos, revisões e alarmes com a web.",
    signIn: "Entrar com o Google",
    signingIn: "Entrando…",
    signInFailed: "Não foi possível entrar. Verifique a conexão e tente de novo.",
    unavailable: "A sincronização não está disponível nesta versão do app.",
    signedInAs: "Conectado como {email}",
    confirmTitle: "Esta conta não é a última usada neste celular",
    confirmBody:
      "Os baralhos, revisões e alarmes deste celular serão juntados aos de {email}. Nada é apagado.",
    merge: "Juntar a esta conta",
    cancel: "Cancelar",
    syncNow: "Sincronizar agora",
    signOut: "Sair",
    signOutNote: "Ao sair, seus dados continuam neste celular.",
    syncing: "Sincronizando…",
    synced: "Sincronizado às {time}",
    notSynced: "Ainda não sincronizado.",
    failed: "Sem conexão. Suas mudanças ficam guardadas e sincronizam depois.",
    updateRequired: "Atualize o app para voltar a sincronizar. Tudo continua funcionando offline.",
    expired: "Sua sessão expirou. Entre de novo para sincronizar.",
    mediaHeld:
      "Algumas imagens ou áudios não foram enviados. As notas que os usam sincronizam depois.",
    mediaMissing:
      "Faltam {count} arquivos de mídia neste celular. Eles chegam na próxima sincronização.",
    mediaRefused:
      "Não há espaço neste celular para as imagens e áudios dos baralhos. Libere espaço e sincronize de novo.",
  },
  en: {
    account: "Account",
    pitch: "Sign in with Google to sync your decks, reviews and alarms with the web.",
    signIn: "Sign in with Google",
    signingIn: "Signing in…",
    signInFailed: "Couldn't sign in. Check your connection and try again.",
    unavailable: "Sync isn't available in this version of the app.",
    signedInAs: "Signed in as {email}",
    confirmTitle: "This isn't the account last used on this phone",
    confirmBody:
      "This phone's decks, reviews and alarms will be merged into {email}'s. Nothing is deleted.",
    merge: "Merge into this account",
    cancel: "Cancel",
    syncNow: "Sync now",
    signOut: "Sign out",
    signOutNote: "Signing out keeps your data on this phone.",
    syncing: "Syncing…",
    synced: "Synced at {time}",
    notSynced: "Not synced yet.",
    failed: "No connection. Your changes are kept and sync later.",
    updateRequired: "Update the app to sync again. Everything keeps working offline.",
    expired: "Your session expired. Sign in again to sync.",
    mediaHeld: "Some images or sounds didn't upload. The notes that use them sync later.",
    mediaMissing: "{count} media files are missing on this phone. They arrive on the next sync.",
    mediaRefused:
      "There's no room on this phone for your decks' images and sounds. Free up space and sync again.",
  },
};

export const syncCopy = (locale: Locale) =>
  translator<keyof (typeof messages)["pt-BR"]>(messages, locale);
