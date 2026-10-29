import { translator, type Locale } from "@app/core";
const messages = {
  "pt-BR": {
    setup: "Prepare seus alarmes",
    reliability: "Confiabilidade dos alarmes",
    settings: "Ajustes",
    intro: "Para o alarme tocar e aparecer mesmo com o celular bloqueado.",
    recommended: "Recomendado para seu celular",
    granted: "Permitido",
    denied: "Toque para permitir",
    manual: "Confira",
    done: "Já fiz",
    finish: "Concluir",
    skip: "Pular por agora",
    atRisk: "Seus alarmes podem não tocar",
    fix: "Corrigir",
    skipTitle: "Pular a preparação?",
    skipMessage: "Seus alarmes podem não tocar. Você pode terminar depois em Ajustes.",
    close: "Voltar",
    appInfo: "Abrir informações do app",
    restricted:
      "Bloqueado? Abra as informações do app, toque em ⋮ e em ‘Permitir configurações restritas’. Depois volte e tente de novo.",
    forceStop:
      "Forçar parada remove os alarmes. Abra o app para reativá-los. Confira estes ajustes novamente após atualizar o sistema.",
    error: "Não foi possível abrir este ajuste. Tente nas informações do app.",
    notifications: "Notificações",
    overlay: "Exibir sobre outros apps",
    fullScreenIntent: "Notificações em tela cheia",
    exactAlarm: "Alarmes exatos",
    battery: "Ignorar otimização de bateria",
    backgroundRestricted: "Atividade em segundo plano",
    autostart: "Início automático",
    lockScreen: "Mostrar na tela de bloqueio",
    backgroundPopups: "Abrir janelas em segundo plano",
    noRestrictions: "Economia de bateria: sem restrições",
    recents: "Manter nos apps recentes",
    neverSleeping: "Apps que nunca entram em suspensão automática",
    motorolaBattery: "Uso da bateria sem restrições",
    notificationsHint:
      "Permita as notificações do app e do canal de alarme para ver o alarme e voltar a ele.",
    overlayHint:
      "Permita aparecer sobre outros apps para o alarme abrir enquanto você usa o celular.",
    fullScreenIntentHint:
      "Permita os alertas em tela cheia para mostrar o alarme sobre a tela bloqueada.",
    exactAlarmHint: "Permita alarmes exatos para tocar na hora marcada.",
    batteryHint:
      "Permita ignorar otimizações de bateria para reduzir interferências do fabricante.",
    backgroundRestrictedHint:
      "Nas informações do app, abra Bateria e selecione Sem restrições. O status indica se o Android permite atividade em segundo plano.",
    autostartHint: "Ative Início automático, ou o alarme não toca depois de reiniciar.",
    lockScreenHint: "Nas permissões do fabricante, ative Mostrar na tela de bloqueio.",
    backgroundPopupsHint: "Nas permissões do fabricante, permita abrir janelas em segundo plano.",
    noRestrictionsHint: "No economizador de bateria do app, escolha Sem restrições.",
    recentsHint:
      "Na lista de apps recentes, abra o menu do app e escolha o cadeado ou Manter aberto.",
    neverSleepingHint:
      "Na lista de apps que nunca entram em suspensão automática, toque em + e adicione este app.",
    motorolaBatteryHint:
      "Em Bateria, escolha Sem restrições e desative Melhorar bateria enquanto inativo.",
  },
  en: {
    setup: "Prepare your alarms",
    reliability: "Alarm reliability",
    settings: "Settings",
    intro: "So alarms ring and show even while the phone is locked.",
    recommended: "Recommended for your phone",
    granted: "Granted",
    denied: "Tap to allow",
    manual: "Check it",
    done: "Done",
    finish: "Finish",
    skip: "Skip for now",
    atRisk: "Your alarms may not ring",
    fix: "Fix",
    skipTitle: "Skip setup?",
    skipMessage: "Your alarms may not ring. You can finish later in Settings.",
    close: "Back",
    appInfo: "Open App info",
    restricted:
      "Blocked? Open App info, tap ⋮ and ‘Allow restricted settings’. Then come back and try again.",
    forceStop:
      "Force-stop removes alarms. Open the app to restore them. Check these settings again after a system update.",
    error: "Could not open this setting. Try App info.",
    notifications: "Notifications",
    overlay: "Display over other apps",
    fullScreenIntent: "Full-screen notifications",
    exactAlarm: "Exact alarms",
    battery: "Ignore battery optimization",
    backgroundRestricted: "Background activity",
    autostart: "Autostart",
    lockScreen: "Show on lock screen",
    backgroundPopups: "Open background windows",
    noRestrictions: "Battery saver: No restrictions",
    recents: "Keep in Recents",
    neverSleeping: "Never auto sleeping apps",
    motorolaBattery: "Unrestricted battery usage",
    notificationsHint:
      "Allow app and alarm-channel notifications to see the alarm and return to it.",
    overlayHint:
      "Allow display over other apps so the alarm can open while you're using the phone.",
    fullScreenIntentHint: "Allow full-screen alerts to show the alarm over the lock screen.",
    exactAlarmHint: "Allow exact alarms to ring at the scheduled time.",
    batteryHint:
      "Allow ignoring battery optimization to reduce interference from the manufacturer.",
    backgroundRestrictedHint:
      "In App info, open Battery and choose Unrestricted. The status shows whether Android allows background activity.",
    autostartHint: "Enable Autostart, or the alarm won't ring after a restart.",
    lockScreenHint: "In the manufacturer's permissions, enable Show on lock screen.",
    backgroundPopupsHint: "In the manufacturer's permissions, allow background windows.",
    noRestrictionsHint: "In the app's battery saver, choose No restrictions.",
    recentsHint: "In Recents, open the app's menu and choose the padlock or Keep open.",
    neverSleepingHint: "In Never auto sleeping apps, tap + and add this app.",
    motorolaBatteryHint:
      "In Battery, choose Unrestricted and turn off Improve battery while inactive.",
  },
};
export const reliabilityCopy = (locale: Locale) =>
  translator<keyof typeof messages.en>(messages, locale);
