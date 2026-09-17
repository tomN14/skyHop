/**
 * Terms of Service gate after login. Session accept or permanent skip via localStorage.
 */
(function () {
  const LS_SKIP_FOREVER = 'SKYHOP_TOS_SKIP_FOREVER';
  const SS_ACCEPTED = 'SKYHOP_TOS_ACCEPTED_SESSION';

  const PAGES = [
    `SKY HOP TERMS OF SERVICE
Last Updated: July 2, 2026

Welcome to Sky Hop. By accessing this game client, hosting levels, participating in multiplayer racing, or interacting with the community, you explicitly agree to be bound by these Terms of Service. If you do not agree to these terms, you are unauthorized to access our servers and your account privileges will be immediately revoked.

1. CODE OF CONDUCT & THE THREE-STRIKE MANDATE

We maintain a zero-tolerance policy for toxic behavior, harassment, and community disruptions.

The Penalty Track: Violations of standard conduct or community guidelines operate on a strict Three-Strike Policy. Each offense adds one persistent strike to your account registry. Upon receiving a third strike, your account is permanently terminated.

Severe Infractions: Highly egregious violations, including database injection attempts, server-side exploits, or targeted harassment campaigns, will bypass the strike track entirely and trigger an immediate, permanent account ban at the absolute discretion of the Administration.`,

    `2. THE ANTI-CHEAT METRIC & REWARD ELIGIBILITY

To protect our leaderboards and in-game economy, the game engine runs real-time automated client-side and server-side kinematic analytics. By playing, you acknowledge that your movement vectors must conform to logical physics constants:

The Movement Requirement: You must register an intentional movement input at least once every ten (10) seconds.

The Spatial Displacement Minimum: Your net spatial displacement across the map grid must exceed five to six (5–6) blocks within every thirty (30) second window.

The Efficiency Heuristic: The engine divides your Net Displacement (vector distance from spawn to finish) by your Total Distance Traveled (scalar movement tracking) every 30 seconds. If this ratio plummets below 0.8, the engine flags the session as idle farming.

The Reward Restriction: Slipping below these mathematical thresholds will not automatically ban you, but it will immediately render your current run ineligible for Personal Best coin rewards or bounty drops.`,

    `3. USER-GENERATED CONTENT & CONTENT TRIAGE

The level editor grants you the privilege to deploy custom stages. However, you do not own this space.

Moderators: All custom stages, chat logs, and player interactions are subject to absolute monitoring by the Moderator Council (identified by their Red Usernames).

Triage Authority: The Moderator Council possesses the sovereign right to review player reports, dismiss nonsensical claims, or escalate malicious violations directly to the Executive Account for ban execution. Custom content deemed inappropriate, broken, or malicious will be erased immediately without warning.

4. APPEALS, SYSTEM MERCY, AND THE CORRUPTION HONEYPOT

If your account faces a ban or reward restriction, you possess a legal path to appeal via direct written correspondence with the Administration.

The Supermajority Threshold: Appeals are handed to our four-member Moderator Council for a blind vote. A minimum 3-1 vote is required to overturn a standard ruling. For severe accusations, a 4-0 unanimous vote is required.

The Mercy Clause: In standard appeals, a 2-2 split tie automatically resolves in favor of the player, and the ban will be lifted based on the philosophy of legitimate doubt.

The Anti-Corruption Tripwire: We operate a zero-tolerance framework regarding staff manipulation. If network telemetry or administrative review reveals that a player attempted to bribe, sway, or collude with exactly two moderators to force a 2-2 tie, the appeal is permanently killed, and the player, along with both colluding moderators, will face an absolute, irreversible database termination.`,

    `5. ROOT ADMINISTRATION & REVERSION RIGHT

The platform engine is a governed sandbox.

The Sovereign Switch: You explicitly acknowledge that the Creator and Lead System Architect retains absolute, raw database read/write permissions.

Final Authority: Regardless of automated engine calculations, client-side flags, or Moderator Council votes, the Creator reserves the right to manually modify, toggle, or rewrite any player record (isBanned: true/false) inside the database environment at any time, for any reason. The database state remains the final, absolute source of truth.

6. RULES OF THE GAME

The game has the following rules. Violation of rules can potentially result from a warning up to a permanent ban.

By clicking “Agree”, you accept all the following rules. These rules have zero exceptions unless approved by the owner. Punishments have zero exceptions unless your appeal is approved.

Section 1: Civil Activity
You may not accept, take, or bribe anyone in the game. If you do, the creator nor any of the staff or users is responsible besides you and the person you are attempting to do malicious activity with.
This is a safe and kind environment. You may not curse, insult, or hurt anyone physically or mentally.
There is zero reason to make any inappropriate thing in the level editor.
All arguments or disagreements in the game shall be settled verbally. The creator is not responsible for any medical injury resulting from civil unrest.
You may not use the game to break any real law or criminal activity.
You are not to use the game in any way that is harmful or malicious, including but not limited to academic misconduct, physical harm, scamming of any kind, or any broken law.
The creator reserves the right to view, edit, or delete any user level when deemed inappropriate. You reserve the right to your levels as intellectual property. You are not to copy any user level directly without the original creator’s permission.
You may not report a user for no reason. You must provide a valid reason for reporting them.`,

    `Section 2: Events and Official Runs
You are not to cheat using a macro, script, or robot during speedruns or official races. Anti-cheat systems are implemented.
Speedruns now require proof of legitimacy.
If you wish to host any race or event that permits the use of macros, scripts, or robots, you must provide a notice to the owner at least a week prior to the event. Your notice would be promptly declined or approved within 3 days.
Events with real prize money should have prize money handled elsewhere. They must also be approved by the owner at least 2 weeks prior to event day. DO NOT ATTEMPT TO GIVE REAL MONEY IN GAME.

Section 3: Additional Terms
You are to accept that every action done in the game can and will be recorded.
Your account statistics can be viewed or edited at any time from the owner.
You are to accept that the owner has absolute power and may ban any user when deemed necessary.
THESE RULES ARE NOT TO BE BROKEN AT ANY TIME UNDER ANY CIRCUMSTANCES. YOU ARE TO UNDERSTAND THAT THESE RULES ARE ABSOLUTE.

NOTE:
You reserve the right to ALL LEVELS you make as creative works. However, the creator reserves the right to view, edit, and delete any level if it is inappropriate for any reason at any time. Once you click next, you accept and acknowledge the above terms under ALL CIRCUMSTANCES. NO EXCEPTIONS UNLESS OTHERWISE PERMITTED BY THE CREATOR.
YOU ARE SOLELY RESPONSIBLE FOR ALL CONSEQUENCES IN-GAME. UNDER NO CIRCUMSTANCES SHALL YOU VIOLATE THE ABOVE TERMS. NOTE THAT BANS APPLY TO ALL USERS, REGARDLESS OF STATUS, AND ALL USERS’ PUNISHMENTS ARE TREATED IDENTICALLY.`,
  ];

  let gatePromise = null;

  function skipForever() {
    try {
      return localStorage.getItem(LS_SKIP_FOREVER) === '1';
    } catch {
      return false;
    }
  }

  function acceptedThisSession() {
    try {
      return sessionStorage.getItem(SS_ACCEPTED) === '1';
    } catch {
      return false;
    }
  }

  function shouldShowGate() {
    return !skipForever() && !acceptedThisSession();
  }

  function markAccepted(forever) {
    try {
      sessionStorage.setItem(SS_ACCEPTED, '1');
      if (forever) localStorage.setItem(LS_SKIP_FOREVER, '1');
    } catch {
      /* */
    }
  }

  function clearSessionAcceptance() {
    try {
      sessionStorage.removeItem(SS_ACCEPTED);
    } catch {
      /* */
    }
  }

  function hideScreen() {
    const el = document.getElementById('screenTos');
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
  }

  function showScreen() {
    const el = document.getElementById('screenTos');
    if (el) {
      el.classList.remove('hidden');
      el.classList.add('flex');
    }
  }

  /**
   * @returns {Promise<void>}
   */
  function gateIfNeeded() {
    if (!shouldShowGate()) return Promise.resolve();
    if (gatePromise) return gatePromise;

    gatePromise = new Promise(function (resolve, reject) {
      const screen = document.getElementById('screenTos');
      const body = document.getElementById('tosBody');
      const stepLabel = document.getElementById('tosStepLabel');
      const btnNext = document.getElementById('tosBtnNext');
      const btnAgree = document.getElementById('tosBtnAgree');
      const btnLogout = document.getElementById('tosBtnLogout');
      const chkSkip = document.getElementById('tosSkipForever');
      const agreeBlock = document.getElementById('tosAgreeBlock');

      if (!screen || !body || !btnNext || !btnAgree) {
        gatePromise = null;
        resolve();
        return;
      }

      let page = 0;
      const last = PAGES.length - 1;

      function renderPage() {
        body.textContent = PAGES[page];
        if (stepLabel) {
          stepLabel.textContent = 'Page ' + (page + 1) + ' of ' + PAGES.length;
        }
        const onLast = page >= last;
        if (agreeBlock) agreeBlock.classList.toggle('hidden', !onLast);
        btnNext.classList.toggle('hidden', onLast);
        btnAgree.classList.toggle('hidden', !onLast);
        if (chkSkip && !onLast) chkSkip.checked = false;
      }

      function finishAccept() {
        const forever = !!(chkSkip && chkSkip.checked);
        markAccepted(forever);
        hideScreen();
        gatePromise = null;
        resolve();
      }

      function onLogoutClick() {
        hideScreen();
        gatePromise = null;
        if (typeof window.SkyHopTosOnLogout === 'function') {
          void window.SkyHopTosOnLogout().then(function () {
            reject(new Error('logged_out'));
          });
        } else {
          reject(new Error('logged_out'));
        }
      }

      const onNext = function () {
        if (page < last) {
          page += 1;
          renderPage();
          body.scrollTop = 0;
        }
      };

      const onAgree = function () {
        finishAccept();
      };

      btnNext.onclick = onNext;
      btnAgree.onclick = onAgree;
      if (btnLogout) btnLogout.onclick = onLogoutClick;

      page = 0;
      renderPage();
      body.scrollTop = 0;
      showScreen();
    });

    return gatePromise.catch(function (e) {
      gatePromise = null;
      throw e;
    });
  }

  window.SkyHopTosGateIfNeeded = gateIfNeeded;
  window.SkyHopTosClearSessionAcceptance = clearSessionAcceptance;
})();
