import { translator, type Locale } from "@app/core";
const messages = {
  "pt-BR": {
    setup: "Prepare seus alarmes",
    reliability: "Confiabilidade dos alarmes",
    settings: "Ajustes",
    intro:
      "Confira estes ajustes para o alarme tocar e aparecer mesmo com o celular bloqueado. Você pode continuar sem permitir e revisar depois em Ajustes.",
    granted: "Permitido",
    denied: "Não permitido",
    unknown: "Não é possível verificar. Confirme manualmente.",
    open: "Abrir ajuste",
    next: "Continuar",
    finish: "Concluir",
    manual: "Já fiz",
    missing: "Não encontrei",
    confirmed: "Confirmado por você; o app não consegue verificar.",
    refresh: "Verificar novamente",
    close: "Voltar",
    appInfo: "Abrir informações do app",
    restricted:
      "Se o Android bloquear o botão: 1. Tente ativar ‘Exibir sobre outros apps’. 2. Abra as informações do app, toque em ⋮ e ‘Permitir configurações restritas’. 3. Volte e ative ‘Exibir sobre outros apps’. Alguns celulares permitem ativar diretamente.",
    forceStop:
      "Forçar parada remove os alarmes. Abra o app para reativá-los. Confira estes ajustes novamente após atualizar o sistema.",
    error:
      "Não foi possível abrir ou verificar este ajuste. Tente novamente nas informações do app.",
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
    autostartHint:
      "Ative Início automático. No Xiaomi, sem isso o alarme não toca após reiniciar o celular.",
    lockScreenHint: "Nas permissões do fabricante, ative Mostrar na tela de bloqueio.",
    backgroundPopupsHint:
      "Nas permissões do fabricante, permita abrir janelas enquanto o app está em segundo plano.",
    noRestrictionsHint: "No economizador de bateria do app, escolha Sem restrições.",
    recentsHint:
      "Abra a lista de apps recentes e o menu do app. Escolha o cadeado ou Manter aberto para evitar o fechamento ao limpar a lista.",
    neverSleepingHint:
      "Na lista de apps que nunca entram em suspensão automática, toque em + e adicione este app. O app não consegue ler essa lista.",
    motorolaBatteryHint:
      "Abra Bateria nas informações do app e escolha Sem restrições. Se existir Melhorar bateria enquanto inativo, desative.",
  },
  en: {
    setup: "Prepare your alarms",
    reliability: "Alarm reliability",
    settings: "Settings",
    intro:
      "Check these settings so alarms can ring and appear while the phone is locked. You can continue without granting access and review this later in Settings.",
    granted: "Granted",
    denied: "Denied",
    unknown: "Can't check. Confirm by hand.",
    open: "Open setting",
    next: "Continue",
    finish: "Finish",
    manual: "Done",
    missing: "I couldn't find it",
    confirmed: "Confirmed by you; the app can't verify this.",
    refresh: "Check again",
    close: "Back",
    appInfo: "Open App info",
    restricted:
      "If Android blocks the toggle: 1. Try turning on ‘Display over other apps’. 2. Open App info, tap ⋮ and ‘Allow restricted settings’. 3. Return and turn on ‘Display over other apps’. Some phones allow it directly.",
    forceStop:
      "Force-stop removes alarms. Open the app to restore them. Check these settings again after a system update.",
    error: "Could not open or check this setting. Try again in App info.",
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
    autostartHint:
      "Enable Autostart. On Xiaomi, without this the alarm won't ring after the phone restarts.",
    lockScreenHint: "In the manufacturer's permissions, enable Show on lock screen.",
    backgroundPopupsHint:
      "In the manufacturer's permissions, allow opening windows while running in the background.",
    noRestrictionsHint: "In the app's battery saver, choose No restrictions.",
    recentsHint:
      "Open Recents and the app's menu. Choose the padlock or Keep open so clearing the list won't close it.",
    neverSleepingHint:
      "In Never auto sleeping apps, tap + and add this app. The app can't read this list.",
    motorolaBatteryHint:
      "Open Battery in App info and choose Unrestricted. Turn off Improve battery while inactive if present.",
  },
};
export const reliabilityCopy = (locale: Locale) =>
  translator<keyof typeof messages.en>(messages, locale);
