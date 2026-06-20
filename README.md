# Nintendo Music PC 🎧

Un client de bureau non-officiel pour **Nintendo Music**, développé avec Electron. Cette application permet d'écouter les musiques officielles de Nintendo directement sur votre ordinateur (Windows, Linux, macOS) tout en intégrant une **Rich Presence Discord** ultra-complète, optimisée et dynamique.

## 🚀 Fonctionnalités

* **Moteur Audio & Sécurité DRM :** Intégration de la version spécialisée d'Electron par *Castlabs* pour prendre en charge nativement les DRM Widevine (évite l'erreur fatale `9012-4001`).
* **Rich Presence Discord Dynamique :**
    * **Affichage en temps réel :** Affiche le titre du morceau actuel et le nom du jeu vidéo (renseigné comme artiste).
    * **Pochettes d'albums dynamiques :** Récupère automatiquement l'URL de l'image de la pochette via l'API `navigator.mediaSession` pour l'afficher sur votre profil Discord.
    * **Chronomètre intelligent :** Affiche la barre de progression temporelle (temps écoulé et restant) synchronisée avec le lecteur.
    * **Statut Instantané Play/Pause :** Détection immédiate (à la milliseconde) des changements d'état audio. En pause, l'activité bascule instantanément sur "Dans les menus" avec l'icône par défaut de l'application.
* **Système Anti-Spam (Cache) :** Le script mémorise l'état de l'activité et n'envoie des requêtes à Discord *que* si un changement réel a lieu (changement de morceau, play, pause, ou déplacement manuel dans la timeline), protégeant ainsi l'application contre les limitations de taux (rate-limiting) de Discord.
* **Intégration CI/CD :** Configuration incluse pour **GitHub Actions** permettant de compiler automatiquement les versions Linux (`.AppImage`) et macOS (`.dmg`) dans le cloud.

## 📦 Prérequis

* [Node.js](https://nodejs.org/) (Version 18 ou supérieure recommandée)

## 🛠️ Installation et Lancement local

1. Clonez ou téléchargez ce dépôt dans votre dossier local.
2. Installez les dépendances du projet :
