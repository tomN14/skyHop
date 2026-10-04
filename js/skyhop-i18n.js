/**
 * Language for Account and cloud stats. English is the default.
 * Other screens stay in English.
 */
(function () {
  var LANGS = [
    { id: 'en', label: 'English' },
    { id: 'es', label: 'Español' },
    { id: 'fr', label: 'Français' },
    { id: 'de', label: 'Deutsch' },
    { id: 'pt', label: 'Português' },
    { id: 'zh', label: '中文' },
    { id: 'ja', label: '日本語' },
    { id: 'ko', label: '한국어' },
  ];
  var EN = {
    'menu.account': 'Account & cloud stats',
    'menu.suggest': 'Suggestions',
    'lang.label': 'Language',
    'lang.hint': 'Choose the language for the whole game here. English is the default.',
    'acc.kicker': 'Cloud profile',
    'acc.title': 'Account',
    'acc.close': 'Close',
    'acc.signinBlurb': 'Sign in on any device with the same username to see the same statistics.',
    'acc.login': 'Log in',
    'acc.username': 'Username',
    'acc.password': 'Password',
    'acc.loginBtn': 'Log in',
    'acc.ownerSecond': 'Second password',
    'acc.ownerSecondConfirm': 'Confirm second password',
    'acc.ownerContinue': 'Continue',
    'acc.ownerCode': 'Email code',
    'acc.ownerConfirmCode': 'Confirm code',
    'acc.ownerSecondHint': 'Enter the second password for this owner account.',
    'acc.ownerSecondSetup': 'Choose a second password (at least 8 characters). It is saved for next time, then a code is emailed to you.',
    'acc.ownerOtpHint': 'Enter the code that was just emailed to you. It expires in 10 minutes.',
    'acc.register': 'Register',
    'acc.usernameRules': 'Username (letters, numbers, _ · 2–24)',
    'acc.passwordRules': 'Password (min 6)',
    'acc.create': 'Create account',
    'acc.signedIn': 'Signed in as',
    'acc.logout': 'Log out',
    'acc.profile': 'Custom profile',
    'acc.bioLabel': 'Bio (max 500 characters)',
    'acc.bioPlaceholder': 'A short line about you…',
    'acc.saveBio': 'Save bio',
    'acc.uploadAvatar': 'Upload avatar',
    'acc.skin': 'Custom skin',
    'acc.defaultLook': 'Default look',
    'acc.apply': 'Apply',
    'acc.report': 'Report a player',
    'acc.theirUser': 'Their username',
    'acc.whatHappened': 'What happened?',
    'acc.reportPlaceholder': 'Describe what happened (min 3 characters)',
    'acc.submitReport': 'Submit report',
    'acc.stats': 'Statistics (all submitted full runs)',
    'acc.score': 'Sky Hop score',
    'acc.runs': 'Runs',
    'acc.coins': 'Coins',
    'acc.deathsTotal': 'Deaths (total)',
    'acc.deathsMin': 'Lowest deaths / run',
    'acc.deathsMax': 'Highest deaths / run',
    'acc.fastest': 'Fastest run',
    'acc.avgTime': 'Avg time / run',
    'acc.avgDeaths': 'Avg deaths / run',
    'acc.achievements': 'Achievements',
    'acc.finishHint': 'Finishing all 50 stages while logged in uploads that run. Progress mid-run is not saved until you win.',
    'band.Unscored': 'Unscored',
    'band.Prime': 'Prime',
    'band.Strong': 'Strong',
    'band.Steady': 'Steady',
    'band.Uneven': 'Uneven',
    'band.Thin': 'Thin',
    'ach.first_clear.title': 'Sky conquered',
    'ach.first_clear.desc': 'Finish all 50 stages once and submit the run.',
    'ach.zero_death.title': 'Untouchable',
    'ach.zero_death.desc': 'Complete a run with 0 deaths.',
    'ach.speed_45.title': 'Swift climber',
    'ach.speed_45.desc': 'Best run under 45 minutes.',
    'ach.speed_20.title': 'Speed demon',
    'ach.speed_20.desc': 'Best run under 20 minutes.',
    'ach.ten_runs.title': 'Veteran',
    'ach.ten_runs.desc': 'Submit 10 completed runs.',
    'ach.fifty_runs.title': 'Obsessed',
    'ach.fifty_runs.desc': 'Submit 50 completed runs.',
    'ach.deaths_100.title': 'Learning curve',
    'ach.deaths_100.desc': '100 total deaths across all runs.',
    'ach.deaths_1000.title': 'Pin cushion',
    'ach.deaths_1000.desc': '1,000 total deaths across all runs.',
    'ach.bloodbath.title': 'One brutal run',
    'ach.bloodbath.desc': 'A single run with at least 80 deaths.',
    'ach.marathon_slow.title': 'Slow and steady',
    'ach.marathon_slow.desc': 'A run longer than 3 hours.',
    'suggest.title': 'Suggestions',
    'suggest.hint': 'Tell the moderators an idea for Sky Hop. A moderator can dismiss it or send it to the owner.',
    'suggest.placeholder': 'Your suggestion',
    'suggest.send': 'Send suggestion',
    'suggest.needLogin': 'Sign in from Account to send a suggestion.',
    'suggest.sent': 'Sent. A moderator will read it.',
  };
  var PACKS = {
    en: EN,
    es: {
      'menu.account': 'Cuenta y estadísticas',
      'menu.suggest': 'Sugerencias',
      'lang.label': 'Idioma',
      'lang.hint': 'Elige aquí el idioma de todo el juego. El inglés es el predeterminado.',
      'acc.kicker': 'Perfil en la nube',
      'acc.title': 'Cuenta',
      'acc.close': 'Cerrar',
      'acc.signinBlurb': 'Entra con el mismo usuario en cualquier dispositivo para ver las mismas estadísticas.',
      'acc.login': 'Entrar',
      'acc.username': 'Usuario',
      'acc.password': 'Contraseña',
      'acc.loginBtn': 'Entrar',
      'acc.ownerSecond': 'Segunda contraseña',
      'acc.ownerSecondConfirm': 'Confirma la segunda contraseña',
      'acc.ownerContinue': 'Continuar',
      'acc.ownerCode': 'Código del correo',
      'acc.ownerConfirmCode': 'Confirmar código',
      'acc.ownerSecondHint': 'Escribe la segunda contraseña de esta cuenta de dueño.',
      'acc.ownerSecondSetup': 'Elige una segunda contraseña (mínimo 8 caracteres). Se guarda para la próxima vez y luego se te envía un código por correo.',
      'acc.ownerOtpHint': 'Escribe el código que acabamos de enviarte por correo. Caduca en 10 minutos.',
      'acc.register': 'Registrarse',
      'acc.usernameRules': 'Usuario (letras, números, _ · 2–24)',
      'acc.passwordRules': 'Contraseña (mínimo 6)',
      'acc.create': 'Crear cuenta',
      'acc.signedIn': 'Sesión de',
      'acc.logout': 'Salir',
      'acc.profile': 'Perfil',
      'acc.bioLabel': 'Bio (máximo 500 caracteres)',
      'acc.bioPlaceholder': 'Una línea sobre ti…',
      'acc.saveBio': 'Guardar bio',
      'acc.uploadAvatar': 'Subir avatar',
      'acc.skin': 'Aspecto',
      'acc.defaultLook': 'Aspecto normal',
      'acc.apply': 'Aplicar',
      'acc.report': 'Reportar a un jugador',
      'acc.theirUser': 'Su usuario',
      'acc.whatHappened': '¿Qué pasó?',
      'acc.reportPlaceholder': 'Describe lo que pasó (mínimo 3 caracteres)',
      'acc.submitReport': 'Enviar reporte',
      'acc.stats': 'Estadísticas (todas las partidas completas enviadas)',
      'acc.score': 'Puntuación Sky Hop',
      'acc.runs': 'Partidas',
      'acc.coins': 'Monedas',
      'acc.deathsTotal': 'Muertes (total)',
      'acc.deathsMin': 'Menos muertes / partida',
      'acc.deathsMax': 'Más muertes / partida',
      'acc.fastest': 'Partida más rápida',
      'acc.avgTime': 'Tiempo medio / partida',
      'acc.avgDeaths': 'Muertes medias / partida',
      'acc.achievements': 'Logros',
      'acc.finishHint': 'Terminar las 50 fases con la sesión iniciada sube esa partida. El progreso a medias no se guarda hasta que ganas.',
      'band.Unscored': 'Sin puntuación',
      'band.Prime': 'Excelente',
      'band.Strong': 'Fuerte',
      'band.Steady': 'Estable',
      'band.Uneven': 'Irregular',
      'band.Thin': 'Escasa',
      'ach.first_clear.title': 'Cielo conquistado',
      'ach.first_clear.desc': 'Termina las 50 fases una vez y envía la partida.',
      'ach.zero_death.title': 'Intocable',
      'ach.zero_death.desc': 'Completa una partida con 0 muertes.',
      'ach.speed_45.title': 'Escalador veloz',
      'ach.speed_45.desc': 'Mejor partida en menos de 45 minutos.',
      'ach.speed_20.title': 'Demonio de la velocidad',
      'ach.speed_20.desc': 'Mejor partida en menos de 20 minutos.',
      'ach.ten_runs.title': 'Veterano',
      'ach.ten_runs.desc': 'Envía 10 partidas completas.',
      'ach.fifty_runs.title': 'Obsesionado',
      'ach.fifty_runs.desc': 'Envía 50 partidas completas.',
      'ach.deaths_100.title': 'Curva de aprendizaje',
      'ach.deaths_100.desc': '100 muertes en total entre todas las partidas.',
      'ach.deaths_1000.title': 'Alfiletero',
      'ach.deaths_1000.desc': '1.000 muertes en total entre todas las partidas.',
      'ach.bloodbath.title': 'Una partida brutal',
      'ach.bloodbath.desc': 'Una sola partida con al menos 80 muertes.',
      'ach.marathon_slow.title': 'Lento y constante',
      'ach.marathon_slow.desc': 'Una partida de más de 3 horas.',
      'suggest.title': 'Sugerencias',
      'suggest.hint': 'Cuéntale a los moderadores una idea para Sky Hop. Un moderador puede descartarla o enviarla al dueño.',
      'suggest.placeholder': 'Tu sugerencia',
      'suggest.send': 'Enviar sugerencia',
      'suggest.needLogin': 'Entra desde Cuenta para enviar una sugerencia.',
      'suggest.sent': 'Enviada. Un moderador la leerá.',
    },
    fr: {
      'menu.account': 'Compte et statistiques',
      'menu.suggest': 'Suggestions',
      'lang.label': 'Langue',
      'lang.hint': 'Choisis ici la langue de tout le jeu. L’anglais est la langue par défaut.',
      'acc.kicker': 'Profil cloud',
      'acc.title': 'Compte',
      'acc.close': 'Fermer',
      'acc.signinBlurb': 'Connecte-toi avec le même nom sur n’importe quel appareil pour voir les mêmes statistiques.',
      'acc.login': 'Connexion',
      'acc.username': 'Nom d’utilisateur',
      'acc.password': 'Mot de passe',
      'acc.loginBtn': 'Se connecter',
      'acc.ownerSecond': 'Deuxième mot de passe',
      'acc.ownerSecondConfirm': 'Confirmez le deuxième mot de passe',
      'acc.ownerContinue': 'Continuer',
      'acc.ownerCode': 'Code e-mail',
      'acc.ownerConfirmCode': 'Confirmer le code',
      'acc.ownerSecondHint': 'Entrez le deuxième mot de passe de ce compte propriétaire.',
      'acc.ownerSecondSetup': 'Choisissez un deuxième mot de passe (8 caractères au moins). Il est enregistré pour la prochaine fois, puis un code vous est envoyé par e-mail.',
      'acc.ownerOtpHint': 'Entrez le code qui vient d’être envoyé par e-mail. Il expire dans 10 minutes.',
      'acc.register': 'Inscription',
      'acc.usernameRules': 'Nom (lettres, chiffres, _ · 2–24)',
      'acc.passwordRules': 'Mot de passe (6 minimum)',
      'acc.create': 'Créer le compte',
      'acc.signedIn': 'Connecté en tant que',
      'acc.logout': 'Se déconnecter',
      'acc.profile': 'Profil',
      'acc.bioLabel': 'Bio (500 caractères max)',
      'acc.bioPlaceholder': 'Une courte ligne sur toi…',
      'acc.saveBio': 'Enregistrer la bio',
      'acc.uploadAvatar': 'Envoyer un avatar',
      'acc.skin': 'Apparence',
      'acc.defaultLook': 'Apparence par défaut',
      'acc.apply': 'Appliquer',
      'acc.report': 'Signaler un joueur',
      'acc.theirUser': 'Son nom',
      'acc.whatHappened': 'Que s’est-il passé ?',
      'acc.reportPlaceholder': 'Décris ce qui s’est passé (3 caractères min)',
      'acc.submitReport': 'Envoyer le signalement',
      'acc.stats': 'Statistiques (toutes les parties complètes envoyées)',
      'acc.score': 'Score Sky Hop',
      'acc.runs': 'Parties',
      'acc.coins': 'Pièces',
      'acc.deathsTotal': 'Morts (total)',
      'acc.deathsMin': 'Moins de morts / partie',
      'acc.deathsMax': 'Plus de morts / partie',
      'acc.fastest': 'Partie la plus rapide',
      'acc.avgTime': 'Temps moyen / partie',
      'acc.avgDeaths': 'Morts moyennes / partie',
      'acc.achievements': 'Succès',
      'acc.finishHint': 'Finir les 50 niveaux en étant connecté envoie cette partie. La progression en cours n’est pas sauvée avant la victoire.',
      'band.Unscored': 'Sans score',
      'band.Prime': 'Excellent',
      'band.Strong': 'Solide',
      'band.Steady': 'Stable',
      'band.Uneven': 'Irrégulier',
      'band.Thin': 'Faible',
      'ach.first_clear.title': 'Ciel conquis',
      'ach.first_clear.desc': 'Termine les 50 niveaux une fois et envoie la partie.',
      'ach.zero_death.title': 'Intouchable',
      'ach.zero_death.desc': 'Termine une partie avec 0 mort.',
      'ach.speed_45.title': 'Grimpeur rapide',
      'ach.speed_45.desc': 'Meilleure partie en moins de 45 minutes.',
      'ach.speed_20.title': 'Démon de vitesse',
      'ach.speed_20.desc': 'Meilleure partie en moins de 20 minutes.',
      'ach.ten_runs.title': 'Vétéran',
      'ach.ten_runs.desc': 'Envoie 10 parties terminées.',
      'ach.fifty_runs.title': 'Obsédé',
      'ach.fifty_runs.desc': 'Envoie 50 parties terminées.',
      'ach.deaths_100.title': 'Courbe d’apprentissage',
      'ach.deaths_100.desc': '100 morts au total sur toutes les parties.',
      'ach.deaths_1000.title': 'Pelote d’épingles',
      'ach.deaths_1000.desc': '1 000 morts au total sur toutes les parties.',
      'ach.bloodbath.title': 'Une partie brutale',
      'ach.bloodbath.desc': 'Une seule partie avec au moins 80 morts.',
      'ach.marathon_slow.title': 'Lent et sûr',
      'ach.marathon_slow.desc': 'Une partie de plus de 3 heures.',
      'suggest.title': 'Suggestions',
      'suggest.hint': 'Propose une idée pour Sky Hop aux modérateurs. Un modérateur peut l’écarter ou l’envoyer au propriétaire.',
      'suggest.placeholder': 'Ta suggestion',
      'suggest.send': 'Envoyer la suggestion',
      'suggest.needLogin': 'Connecte-toi depuis Compte pour envoyer une suggestion.',
      'suggest.sent': 'Envoyée. Un modérateur la lira.',
    },
    de: {
      'menu.account': 'Konto und Statistiken',
      'menu.suggest': 'Vorschläge',
      'lang.label': 'Sprache',
      'lang.hint': 'Wähle hier die Sprache für das ganze Spiel. Englisch ist die Vorgabe.',
      'acc.kicker': 'Cloud-Profil',
      'acc.title': 'Konto',
      'acc.close': 'Schließen',
      'acc.signinBlurb': 'Melde dich auf jedem Gerät mit demselben Namen an, um dieselben Statistiken zu sehen.',
      'acc.login': 'Anmelden',
      'acc.username': 'Benutzername',
      'acc.password': 'Passwort',
      'acc.loginBtn': 'Anmelden',
      'acc.ownerSecond': 'Zweites Passwort',
      'acc.ownerSecondConfirm': 'Zweites Passwort bestätigen',
      'acc.ownerContinue': 'Weiter',
      'acc.ownerCode': 'E-Mail-Code',
      'acc.ownerConfirmCode': 'Code bestätigen',
      'acc.ownerSecondHint': 'Gib das zweite Passwort für dieses Besitzerkonto ein.',
      'acc.ownerSecondSetup': 'Wähle ein zweites Passwort (mindestens 8 Zeichen). Es wird für das nächste Mal gespeichert, danach kommt ein Code per E-Mail.',
      'acc.ownerOtpHint': 'Gib den Code ein, der gerade per E-Mail geschickt wurde. Er gilt 10 Minuten.',
      'acc.register': 'Registrieren',
      'acc.usernameRules': 'Name (Buchstaben, Zahlen, _ · 2–24)',
      'acc.passwordRules': 'Passwort (mind. 6)',
      'acc.create': 'Konto erstellen',
      'acc.signedIn': 'Angemeldet als',
      'acc.logout': 'Abmelden',
      'acc.profile': 'Profil',
      'acc.bioLabel': 'Bio (höchstens 500 Zeichen)',
      'acc.bioPlaceholder': 'Eine kurze Zeile über dich…',
      'acc.saveBio': 'Bio speichern',
      'acc.uploadAvatar': 'Avatar hochladen',
      'acc.skin': 'Aussehen',
      'acc.defaultLook': 'Standardaussehen',
      'acc.apply': 'Übernehmen',
      'acc.report': 'Spieler melden',
      'acc.theirUser': 'Deren Benutzername',
      'acc.whatHappened': 'Was ist passiert?',
      'acc.reportPlaceholder': 'Beschreibe, was passiert ist (mind. 3 Zeichen)',
      'acc.submitReport': 'Meldung senden',
      'acc.stats': 'Statistiken (alle eingesandten vollen Läufe)',
      'acc.score': 'Sky-Hop-Wert',
      'acc.runs': 'Läufe',
      'acc.coins': 'Münzen',
      'acc.deathsTotal': 'Tode (gesamt)',
      'acc.deathsMin': 'Wenigste Tode / Lauf',
      'acc.deathsMax': 'Meiste Tode / Lauf',
      'acc.fastest': 'Schnellster Lauf',
      'acc.avgTime': 'Mittlere Zeit / Lauf',
      'acc.avgDeaths': 'Mittlere Tode / Lauf',
      'acc.achievements': 'Erfolge',
      'acc.finishHint': 'Alle 50 Stufen im eingeloggten Zustand zu schaffen lädt diesen Lauf hoch. Fortschritt mittendrin wird erst beim Sieg gespeichert.',
      'band.Unscored': 'Ohne Wert',
      'band.Prime': 'Erstklassig',
      'band.Strong': 'Stark',
      'band.Steady': 'Stabil',
      'band.Uneven': 'Uneben',
      'band.Thin': 'Dünn',
      'ach.first_clear.title': 'Himmel erobert',
      'ach.first_clear.desc': 'Schaffe alle 50 Stufen einmal und sende den Lauf.',
      'ach.zero_death.title': 'Unberührbar',
      'ach.zero_death.desc': 'Schließe einen Lauf mit 0 Toden ab.',
      'ach.speed_45.title': 'Schneller Kletterer',
      'ach.speed_45.desc': 'Bester Lauf unter 45 Minuten.',
      'ach.speed_20.title': 'Geschwindigkeitsdämon',
      'ach.speed_20.desc': 'Bester Lauf unter 20 Minuten.',
      'ach.ten_runs.title': 'Veteran',
      'ach.ten_runs.desc': 'Sende 10 abgeschlossene Läufe.',
      'ach.fifty_runs.title': 'Besessen',
      'ach.fifty_runs.desc': 'Sende 50 abgeschlossene Läufe.',
      'ach.deaths_100.title': 'Lernkurve',
      'ach.deaths_100.desc': '100 Tode insgesamt über alle Läufe.',
      'ach.deaths_1000.title': 'Nadelkissen',
      'ach.deaths_1000.desc': '1.000 Tode insgesamt über alle Läufe.',
      'ach.bloodbath.title': 'Ein brutaler Lauf',
      'ach.bloodbath.desc': 'Ein einzelner Lauf mit mindestens 80 Toden.',
      'ach.marathon_slow.title': 'Langsam und stetig',
      'ach.marathon_slow.desc': 'Ein Lauf länger als 3 Stunden.',
      'suggest.title': 'Vorschläge',
      'suggest.hint': 'Schick den Moderatoren eine Idee für Sky Hop. Ein Moderator kann sie verwerfen oder an den Besitzer schicken.',
      'suggest.placeholder': 'Dein Vorschlag',
      'suggest.send': 'Vorschlag senden',
      'suggest.needLogin': 'Melde dich über Konto an, um einen Vorschlag zu senden.',
      'suggest.sent': 'Gesendet. Ein Moderator liest ihn.',
    },
    pt: {
      'menu.account': 'Conta e estatísticas',
      'menu.suggest': 'Sugestões',
      'lang.label': 'Idioma',
      'lang.hint': 'Escolha aqui o idioma do jogo inteiro. Inglês é o padrão.',
      'acc.kicker': 'Perfil na nuvem',
      'acc.title': 'Conta',
      'acc.close': 'Fechar',
      'acc.signinBlurb': 'Entra com o mesmo nome em qualquer aparelho para ver as mesmas estatísticas.',
      'acc.login': 'Entrar',
      'acc.username': 'Usuário',
      'acc.password': 'Senha',
      'acc.loginBtn': 'Entrar',
      'acc.ownerSecond': 'Segunda senha',
      'acc.ownerSecondConfirm': 'Confirma a segunda senha',
      'acc.ownerContinue': 'Continuar',
      'acc.ownerCode': 'Código do e-mail',
      'acc.ownerConfirmCode': 'Confirmar código',
      'acc.ownerSecondHint': 'Escreve a segunda senha desta conta de dono.',
      'acc.ownerSecondSetup': 'Escolhe uma segunda senha (mínimo 8 caracteres). Fica guardada para a próxima vez e depois é enviado um código por e-mail.',
      'acc.ownerOtpHint': 'Escreve o código que acabou de ser enviado por e-mail. Expira em 10 minutos.',
      'acc.register': 'Registrar',
      'acc.usernameRules': 'Usuário (letras, números, _ · 2–24)',
      'acc.passwordRules': 'Senha (mínimo 6)',
      'acc.create': 'Criar conta',
      'acc.signedIn': 'Sessão de',
      'acc.logout': 'Sair',
      'acc.profile': 'Perfil',
      'acc.bioLabel': 'Bio (máximo 500 caracteres)',
      'acc.bioPlaceholder': 'Uma linha sobre você…',
      'acc.saveBio': 'Salvar bio',
      'acc.uploadAvatar': 'Enviar avatar',
      'acc.skin': 'Visual',
      'acc.defaultLook': 'Visual padrão',
      'acc.apply': 'Aplicar',
      'acc.report': 'Denunciar um jogador',
      'acc.theirUser': 'Usuário da pessoa',
      'acc.whatHappened': 'O que aconteceu?',
      'acc.reportPlaceholder': 'Descreva o que aconteceu (mínimo 3 caracteres)',
      'acc.submitReport': 'Enviar denúncia',
      'acc.stats': 'Estatísticas (todas as partidas completas enviadas)',
      'acc.score': 'Pontuação Sky Hop',
      'acc.runs': 'Partidas',
      'acc.coins': 'Moedas',
      'acc.deathsTotal': 'Mortes (total)',
      'acc.deathsMin': 'Menos mortes / partida',
      'acc.deathsMax': 'Mais mortes / partida',
      'acc.fastest': 'Partida mais rápida',
      'acc.avgTime': 'Tempo médio / partida',
      'acc.avgDeaths': 'Mortes médias / partida',
      'acc.achievements': 'Conquistas',
      'acc.finishHint': 'Terminar as 50 fases logado envia essa partida. O progresso no meio não é salvo até você vencer.',
      'band.Unscored': 'Sem pontuação',
      'band.Prime': 'Excelente',
      'band.Strong': 'Forte',
      'band.Steady': 'Estável',
      'band.Uneven': 'Irregular',
      'band.Thin': 'Fraca',
      'ach.first_clear.title': 'Céu conquistado',
      'ach.first_clear.desc': 'Termine as 50 fases uma vez e envie a partida.',
      'ach.zero_death.title': 'Intocável',
      'ach.zero_death.desc': 'Complete uma partida com 0 mortes.',
      'ach.speed_45.title': 'Escalador veloz',
      'ach.speed_45.desc': 'Melhor partida em menos de 45 minutos.',
      'ach.speed_20.title': 'Demônio da velocidade',
      'ach.speed_20.desc': 'Melhor partida em menos de 20 minutos.',
      'ach.ten_runs.title': 'Veterano',
      'ach.ten_runs.desc': 'Envie 10 partidas completas.',
      'ach.fifty_runs.title': 'Obcecado',
      'ach.fifty_runs.desc': 'Envie 50 partidas completas.',
      'ach.deaths_100.title': 'Curva de aprendizado',
      'ach.deaths_100.desc': '100 mortes no total em todas as partidas.',
      'ach.deaths_1000.title': 'Alfineteiro',
      'ach.deaths_1000.desc': '1.000 mortes no total em todas as partidas.',
      'ach.bloodbath.title': 'Uma partida brutal',
      'ach.bloodbath.desc': 'Uma única partida com pelo menos 80 mortes.',
      'ach.marathon_slow.title': 'Devagar e sempre',
      'ach.marathon_slow.desc': 'Uma partida com mais de 3 horas.',
      'suggest.title': 'Sugestões',
      'suggest.hint': 'Conte aos moderadores uma ideia para o Sky Hop. Um moderador pode descartá-la ou enviá-la ao dono.',
      'suggest.placeholder': 'Sua sugestão',
      'suggest.send': 'Enviar sugestão',
      'suggest.needLogin': 'Entre pela Conta para enviar uma sugestão.',
      'suggest.sent': 'Enviada. Um moderador vai ler.',
    },
    zh: {
      'menu.account': '账户和统计',
      'menu.suggest': '建议',
      'lang.label': '语言',
      'lang.hint': '在这里选择整个游戏的语言。默认是英文。',
      'acc.kicker': '云端资料',
      'acc.title': '账户',
      'acc.close': '关闭',
      'acc.signinBlurb': '在任何设备上用同一个用户名登录，就能看到同一份统计。',
      'acc.login': '登录',
      'acc.username': '用户名',
      'acc.password': '密码',
      'acc.loginBtn': '登录',
      'acc.ownerSecond': '第二密码',
      'acc.ownerSecondConfirm': '确认第二密码',
      'acc.ownerContinue': '继续',
      'acc.ownerCode': '邮箱验证码',
      'acc.ownerConfirmCode': '确认验证码',
      'acc.ownerSecondHint': '输入这个拥有者账户的第二密码。',
      'acc.ownerSecondSetup': '设置第二密码（至少 8 位）。它会保存下来，然后验证码会发到你的邮箱。',
      'acc.ownerOtpHint': '输入刚刚发到邮箱的验证码。10 分钟内有效。',
      'acc.register': '注册',
      'acc.usernameRules': '用户名（字母、数字、_ · 2–24）',
      'acc.passwordRules': '密码（至少 6 位）',
      'acc.create': '创建账户',
      'acc.signedIn': '已登录',
      'acc.logout': '退出',
      'acc.profile': '个人资料',
      'acc.bioLabel': '简介（最多 500 字）',
      'acc.bioPlaceholder': '用一句话介绍自己…',
      'acc.saveBio': '保存简介',
      'acc.uploadAvatar': '上传头像',
      'acc.skin': '外观',
      'acc.defaultLook': '默认外观',
      'acc.apply': '应用',
      'acc.report': '举报玩家',
      'acc.theirUser': '对方用户名',
      'acc.whatHappened': '发生了什么？',
      'acc.reportPlaceholder': '描述发生的事（至少 3 个字）',
      'acc.submitReport': '提交举报',
      'acc.stats': '统计（所有已提交的完整通关）',
      'acc.score': 'Sky Hop 分数',
      'acc.runs': '次数',
      'acc.coins': '金币',
      'acc.deathsTotal': '死亡（合计）',
      'acc.deathsMin': '单次最少死亡',
      'acc.deathsMax': '单次最多死亡',
      'acc.fastest': '最快通关',
      'acc.avgTime': '平均用时',
      'acc.avgDeaths': '平均死亡',
      'acc.achievements': '成就',
      'acc.finishHint': '登录后打完全部 50 关会上传这次记录。通关之前，中途进度不会保存。',
      'band.Unscored': '未评分',
      'band.Prime': '优秀',
      'band.Strong': '良好',
      'band.Steady': '稳定',
      'band.Uneven': '不稳',
      'band.Thin': '偏低',
      'ach.first_clear.title': '征服天空',
      'ach.first_clear.desc': '通关全部 50 关一次并提交记录。',
      'ach.zero_death.title': '无人能及',
      'ach.zero_death.desc': '以 0 死亡完成一次通关。',
      'ach.speed_45.title': '迅捷攀登者',
      'ach.speed_45.desc': '最佳通关少于 45 分钟。',
      'ach.speed_20.title': '速度恶魔',
      'ach.speed_20.desc': '最佳通关少于 20 分钟。',
      'ach.ten_runs.title': '老手',
      'ach.ten_runs.desc': '提交 10 次完整通关。',
      'ach.fifty_runs.title': '着迷',
      'ach.fifty_runs.desc': '提交 50 次完整通关。',
      'ach.deaths_100.title': '学习曲线',
      'ach.deaths_100.desc': '所有通关合计死亡 100 次。',
      'ach.deaths_1000.title': '针垫',
      'ach.deaths_1000.desc': '所有通关合计死亡 1,000 次。',
      'ach.bloodbath.title': '一次残酷通关',
      'ach.bloodbath.desc': '单次通关至少死亡 80 次。',
      'ach.marathon_slow.title': '稳扎稳打',
      'ach.marathon_slow.desc': '一次通关超过 3 小时。',
      'suggest.title': '建议',
      'suggest.hint': '把对 Sky Hop 的想法发给管理员。管理员可以忽略，或转给站长。',
      'suggest.placeholder': '你的建议',
      'suggest.send': '发送建议',
      'suggest.needLogin': '请先在账户里登录，再发送建议。',
      'suggest.sent': '已发送。管理员会看。',
    },
    ja: {
      'menu.account': 'アカウントと統計',
      'menu.suggest': '提案',
      'lang.label': '言語',
      'lang.hint': 'ここでゲーム全体の言語を選びます。初期設定は英語です。',
      'acc.kicker': 'クラウドプロフィール',
      'acc.title': 'アカウント',
      'acc.close': '閉じる',
      'acc.signinBlurb': '同じユーザー名でどの端末から入っても、同じ統計が見られます。',
      'acc.login': 'ログイン',
      'acc.username': 'ユーザー名',
      'acc.password': 'パスワード',
      'acc.loginBtn': 'ログイン',
      'acc.ownerSecond': '2つ目のパスワード',
      'acc.ownerSecondConfirm': '2つ目のパスワードを確認',
      'acc.ownerContinue': '続ける',
      'acc.ownerCode': 'メールのコード',
      'acc.ownerConfirmCode': 'コードを確認',
      'acc.ownerSecondHint': 'このオーナーアカウントの2つ目のパスワードを入力してください。',
      'acc.ownerSecondSetup': '2つ目のパスワードを決めてください（8文字以上）。次回からも使われ、そのあとコードがメールで届きます。',
      'acc.ownerOtpHint': '今メールで送ったコードを入力してください。10分で期限が切れます。',
      'acc.register': '登録',
      'acc.usernameRules': 'ユーザー名（英数字と _ · 2–24）',
      'acc.passwordRules': 'パスワード（6文字以上）',
      'acc.create': 'アカウントを作る',
      'acc.signedIn': 'ログイン中',
      'acc.logout': 'ログアウト',
      'acc.profile': 'プロフィール',
      'acc.bioLabel': '自己紹介（500文字まで）',
      'acc.bioPlaceholder': '自分についての短い一文…',
      'acc.saveBio': '自己紹介を保存',
      'acc.uploadAvatar': 'アバターを送る',
      'acc.skin': '見た目',
      'acc.defaultLook': '標準の見た目',
      'acc.apply': '適用',
      'acc.report': 'プレイヤーを報告',
      'acc.theirUser': '相手のユーザー名',
      'acc.whatHappened': '何がありましたか？',
      'acc.reportPlaceholder': '何があったか書いてください（3文字以上）',
      'acc.submitReport': '報告を送る',
      'acc.stats': '統計（送信した全クリア）',
      'acc.score': 'Sky Hop スコア',
      'acc.runs': '回数',
      'acc.coins': 'コイン',
      'acc.deathsTotal': '死亡（合計）',
      'acc.deathsMin': '1回の最少死亡',
      'acc.deathsMax': '1回の最多死亡',
      'acc.fastest': '最速クリア',
      'acc.avgTime': '平均時間',
      'acc.avgDeaths': '平均死亡',
      'acc.achievements': '実績',
      'acc.finishHint': 'ログインしたまま50ステージを終えるとその記録が送られます。クリアするまで途中の進行は保存されません。',
      'band.Unscored': '未評価',
      'band.Prime': '最上',
      'band.Strong': '良好',
      'band.Steady': '安定',
      'band.Uneven': '不安定',
      'band.Thin': '低め',
      'ach.first_clear.title': '空を制した',
      'ach.first_clear.desc': '50ステージを一度クリアして記録を送る。',
      'ach.zero_death.title': '無傷',
      'ach.zero_death.desc': '死亡0でクリアする。',
      'ach.speed_45.title': '素早い登り',
      'ach.speed_45.desc': '自己ベストが45分未満。',
      'ach.speed_20.title': '速度の悪魔',
      'ach.speed_20.desc': '自己ベストが20分未満。',
      'ach.ten_runs.title': 'ベテラン',
      'ach.ten_runs.desc': 'クリアを10回送る。',
      'ach.fifty_runs.title': '夢中',
      'ach.fifty_runs.desc': 'クリアを50回送る。',
      'ach.deaths_100.title': '学習曲線',
      'ach.deaths_100.desc': 'すべてのクリアで死亡が合計100。',
      'ach.deaths_1000.title': '針山',
      'ach.deaths_1000.desc': 'すべてのクリアで死亡が合計1,000。',
      'ach.bloodbath.title': '過酷な一回',
      'ach.bloodbath.desc': '1回のクリアで死亡が80以上。',
      'ach.marathon_slow.title': 'ゆっくり着実に',
      'ach.marathon_slow.desc': '3時間を超えるクリア。',
      'suggest.title': '提案',
      'suggest.hint': 'Sky Hop へのアイデアをモデレーターに送ります。モデレーターは却下するか、オーナーに回せます。',
      'suggest.placeholder': '提案',
      'suggest.send': '提案を送る',
      'suggest.needLogin': '提案を送るには、アカウントからログインしてください。',
      'suggest.sent': '送りました。モデレーターが読みます。',
    },
    ko: {
      'menu.account': '계정과 통계',
      'menu.suggest': '제안',
      'lang.label': '언어',
      'lang.hint': '여기서 게임 전체의 언어를 고릅니다. 기본값은 영어입니다.',
      'acc.kicker': '클라우드 프로필',
      'acc.title': '계정',
      'acc.close': '닫기',
      'acc.signinBlurb': '어느 기기에서든 같은 사용자 이름으로 로그인하면 같은 통계를 봅니다.',
      'acc.login': '로그인',
      'acc.username': '사용자 이름',
      'acc.password': '비밀번호',
      'acc.loginBtn': '로그인',
      'acc.ownerSecond': '두 번째 비밀번호',
      'acc.ownerSecondConfirm': '두 번째 비밀번호 확인',
      'acc.ownerContinue': '계속',
      'acc.ownerCode': '이메일 코드',
      'acc.ownerConfirmCode': '코드 확인',
      'acc.ownerSecondHint': '이 소유자 계정의 두 번째 비밀번호를 입력하세요.',
      'acc.ownerSecondSetup': '두 번째 비밀번호를 정하세요(8자 이상). 다음에도 저장되고, 그다음 코드가 이메일로 갑니다.',
      'acc.ownerOtpHint': '방금 이메일로 보낸 코드를 입력하세요. 10분 뒤 만료됩니다.',
      'acc.register': '가입',
      'acc.usernameRules': '사용자 이름 (영문, 숫자, _ · 2–24)',
      'acc.passwordRules': '비밀번호 (최소 6자)',
      'acc.create': '계정 만들기',
      'acc.signedIn': '로그인',
      'acc.logout': '로그아웃',
      'acc.profile': '프로필',
      'acc.bioLabel': '소개 (최대 500자)',
      'acc.bioPlaceholder': '자신에 대한 짧은 한 줄…',
      'acc.saveBio': '소개 저장',
      'acc.uploadAvatar': '아바타 올리기',
      'acc.skin': '모습',
      'acc.defaultLook': '기본 모습',
      'acc.apply': '적용',
      'acc.report': '플레이어 신고',
      'acc.theirUser': '상대 사용자 이름',
      'acc.whatHappened': '무슨 일이 있었나요?',
      'acc.reportPlaceholder': '무슨 일이 있었는지 적어 주세요 (최소 3자)',
      'acc.submitReport': '신고 보내기',
      'acc.stats': '통계 (제출한 모든 완주)',
      'acc.score': 'Sky Hop 점수',
      'acc.runs': '횟수',
      'acc.coins': '코인',
      'acc.deathsTotal': '사망 (합계)',
      'acc.deathsMin': '한 판 최소 사망',
      'acc.deathsMax': '한 판 최대 사망',
      'acc.fastest': '가장 빠른 완주',
      'acc.avgTime': '평균 시간',
      'acc.avgDeaths': '평균 사망',
      'acc.achievements': '업적',
      'acc.finishHint': '로그인한 채로 50스테이지를 끝내면 그 기록이 올라갑니다. 이기기 전에는 중간 진행이 저장되지 않습니다.',
      'band.Unscored': '점수 없음',
      'band.Prime': '최상',
      'band.Strong': '우수',
      'band.Steady': '안정',
      'band.Uneven': '불안정',
      'band.Thin': '낮음',
      'ach.first_clear.title': '하늘을 정복',
      'ach.first_clear.desc': '50스테이지를 한 번 끝내고 기록을 제출합니다.',
      'ach.zero_death.title': '무손상',
      'ach.zero_death.desc': '사망 0으로 완주합니다.',
      'ach.speed_45.title': '빠른 등반가',
      'ach.speed_45.desc': '최단 기록이 45분 미만입니다.',
      'ach.speed_20.title': '속도의 악마',
      'ach.speed_20.desc': '최단 기록이 20분 미만입니다.',
      'ach.ten_runs.title': '베테랑',
      'ach.ten_runs.desc': '완주를 10번 제출합니다.',
      'ach.fifty_runs.title': '몰두',
      'ach.fifty_runs.desc': '완주를 50번 제출합니다.',
      'ach.deaths_100.title': '학습 곡선',
      'ach.deaths_100.desc': '모든 완주의 사망 합계가 100입니다.',
      'ach.deaths_1000.title': '바늘 방석',
      'ach.deaths_1000.desc': '모든 완주의 사망 합계가 1,000입니다.',
      'ach.bloodbath.title': '혹독한 한 판',
      'ach.bloodbath.desc': '한 번의 완주에서 사망이 80 이상입니다.',
      'ach.marathon_slow.title': '천천히 꾸준히',
      'ach.marathon_slow.desc': '3시간이 넘는 완주입니다.',
      'suggest.title': '제안',
      'suggest.hint': 'Sky Hop에 대한 생각을 운영진에게 보냅니다. 운영진은 거절하거나 소유자에게 보낼 수 있습니다.',
      'suggest.placeholder': '제안',
      'suggest.send': '제안 보내기',
      'suggest.needLogin': '제안을 보내려면 계정에서 로그인하세요.',
      'suggest.sent': '보냈습니다. 운영진이 읽습니다.',
    },
  };

  var current = 'en';

  function known(code) {
    return PACKS[code] ? code : 'en';
  }

  function t(key, fallback) {
    var pack = PACKS[current] || EN;
    if (pack[key] != null) return pack[key];
    if (EN[key] != null) return EN[key];
    return fallback != null ? fallback : key;
  }

  function apply() {
    applying = true;
    try {
      document.querySelectorAll('[data-i18n]').forEach(function (node) {
        var key = node.getAttribute('data-i18n');
        if (!key) return;
        node.textContent = t(key);
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(function (node) {
        var key = node.getAttribute('data-i18n-placeholder');
        if (!key) return;
        node.setAttribute('placeholder', t(key));
      });
      document.querySelectorAll('.js-lang-select').forEach(function (sel) {
        if (sel.value !== current) sel.value = current;
      });
      if (document.body) walk(document.body);
    } finally {
      applying = false;
    }
  }

  var applying = false;
  var SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1 };

  function phrase(en) {
    if (current === 'en') return en;
    var packs = window.SKYHOP_PHRASES;
    var pack = packs && packs[current];
    if (pack && Object.prototype.hasOwnProperty.call(pack, en)) return pack[en];
    return null;
  }

  var phraseList = null;
  var phraseListLang = '';

  function phraseEntries() {
    var pack = window.SKYHOP_PHRASES && window.SKYHOP_PHRASES[current];
    if (!pack) return [];
    if (phraseList && phraseListLang === current) return phraseList;
    phraseList = Object.keys(pack)
      .filter(function (key) { return key.length >= 4; })
      .sort(function (a, b) { return b.length - a.length; })
      .map(function (key) {
        var esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var pre = /^[A-Za-z0-9]/.test(key) ? '(^|[^A-Za-z0-9])' : '()';
        var post = /[A-Za-z0-9]$/.test(key) ? '(?![A-Za-z0-9])' : '';
        return { key: key, re: new RegExp(pre + esc + post, 'g'), to: pack[key] };
      });
    phraseListLang = current;
    return phraseList;
  }

  function phraseText(english) {
    var exact = phrase(english);
    if (exact) return exact;
    if (current === 'en') return english;
    var out = english;
    phraseEntries().forEach(function (row) {
      if (out.indexOf(row.key) === -1) return;
      row.re.lastIndex = 0;
      out = out.replace(row.re, function (match, pre) {
        return (pre || '') + row.to;
      });
    });
    return out;
  }

  function translateTextNode(node) {
    var parent = node.parentElement;
    if (!parent || SKIP_TAG[parent.tagName]) return;
    if (parent.closest && parent.closest('[data-i18n], [data-no-i18n], code, kbd, .font-mono')) return;
    if (node.__en == null) node.__en = node.nodeValue;
    var original = node.__en;
    if (original == null) return;
    var trimmed = String(original).trim();
    if (!trimmed || !/[A-Za-zÀ-ÿ]/.test(trimmed)) return;
    if (/skyhop\.|test\.(while|if|for|else|break)/.test(trimmed) && trimmed.length > 80) return;
    var next = current === 'en' ? trimmed : phraseText(trimmed);
    var lead = String(original).match(/^\s*/)[0];
    var trail = String(original).match(/\s*$/)[0];
    var value = lead + next + trail;
    if (node.nodeValue !== value) node.nodeValue = value;
  }

  function translateAttrs(el) {
    if (!el || el.nodeType !== 1 || SKIP_TAG[el.tagName]) return;
    ['placeholder', 'title', 'aria-label'].forEach(function (attr) {
      if (attr === 'placeholder' && el.hasAttribute('data-i18n-placeholder')) return;
      if (!el.hasAttribute(attr)) return;
      var storeKey = '__skyhop_' + attr;
      if (el[storeKey] == null) el[storeKey] = el.getAttribute(attr);
      var original = el[storeKey];
      var trimmed = String(original == null ? '' : original).trim();
      if (!trimmed) return;
      var next = current === 'en' ? trimmed : phraseText(trimmed);
      if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
    });
  }

  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      translateTextNode(node);
      return;
    }
    if (node.nodeType !== 1 || SKIP_TAG[node.tagName]) return;
    translateAttrs(node);
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i += 1) walk(kids[i]);
  }

  function noteFreshText(node) {
    var incoming = node.nodeValue;
    if (current === 'en' || node.__en == null) {
      node.__en = incoming;
      return;
    }
    var trimmed = String(node.__en).trim();
    var expected = phraseText(trimmed);
    var lead = String(node.__en).match(/^\s*/)[0];
    var trail = String(node.__en).match(/\s*$/)[0];
    if (incoming !== lead + expected + trail) node.__en = incoming;
  }

  function watch() {
    if (!document.body || window.__skyhopI18nWatch) return;
    window.__skyhopI18nWatch = true;
    new MutationObserver(function (list) {
      if (applying) return;
      applying = true;
      try {
        list.forEach(function (m) {
          if (m.type === 'characterData') {
            noteFreshText(m.target);
            translateTextNode(m.target);
          } else if (m.type === 'childList') {
            m.addedNodes.forEach(walk);
          } else if (m.type === 'attributes') {
            var attr = m.attributeName;
            if (attr === 'placeholder' || attr === 'title' || attr === 'aria-label') {
              var el = m.target;
              var storeKey = '__skyhop_' + attr;
              var now = el.getAttribute(attr);
              var prev = el[storeKey];
              var prevShown = prev == null ? null : phraseText(String(prev).trim());
              if (prev == null || now !== prevShown) el[storeKey] = now;
              translateAttrs(el);
            }
          }
        });
      } finally {
        applying = false;
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label'],
    });
  }

  function savedCode() {
    try {
      return known(localStorage.getItem('SKYHOP_LANG') || 'en');
    } catch (e) {
      return 'en';
    }
  }

  function token() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN') || '';
    } catch (e) {
      return '';
    }
  }

  function set(code, opts) {
    current = known(code);
    try {
      localStorage.setItem('SKYHOP_LANG', current);
    } catch (e) {
      /* */
    }
    apply();
    try {
      window.dispatchEvent(new CustomEvent('skyhop-lang'));
    } catch (e2) {
      /* */
    }
    var skip = opts && opts.skipSave;
    if (skip || !token() || typeof window.SkyHopApiRequest !== 'function') return;
    window
      .SkyHopApiRequest('/api/me/locale', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: current }),
      })
      .catch(function () {});
  }

  function fillSelect(sel) {
    sel.textContent = '';
    LANGS.forEach(function (lang) {
      var opt = document.createElement('option');
      opt.value = lang.id;
      opt.textContent = lang.label;
      sel.appendChild(opt);
    });
    sel.value = current;
    sel.addEventListener('change', function () {
      set(sel.value);
    });
  }

  function boot() {
    current = savedCode();
    document.querySelectorAll('.js-lang-select').forEach(fillSelect);
    apply();
    watch();
  }

  window.SkyHopI18n = {
    t: t,
    set: set,
    get: function () {
      return current;
    },
    apply: apply,
    text: phraseText,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
