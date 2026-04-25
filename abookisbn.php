<?php
/**
 * Plugin : plg_system_abookisbn
 * Récupération automatique des métadonnées ISBN pour Alexandria Book Library
 * Compatible Joomla 4 / 5
 */
defined('_JEXEC') or die;

use Joomla\CMS\Plugin\CMSPlugin;
use Joomla\CMS\Factory;
use Joomla\CMS\Uri\Uri;
use Joomla\CMS\Application\ApplicationHelper;

class PlgSystemAbookisbn extends CMSPlugin
{
    // =========================================================
    // Chargement du JS uniquement sur la page d'édition de livre
    // =========================================================
    public function onBeforeRender()
    {
        $app = Factory::getApplication();
        if (!$app->isClient('administrator')) return;

        $input = $app->getInput();
        if ($input->get('option') === 'com_abook'
            && $input->get('view') === 'book') {
            Factory::getDocument()->addScript(
                Uri::root() . 'plugins/system/abookisbn/js/isbn_lookup.js'
            );
        }
    }

    // =========================================================
    // Interception AJAX via onAfterRoute
    // Partage la même session que le backend Joomla
    // =========================================================
    public function onAfterRoute()
    {
        $app   = Factory::getApplication();
        $input = $app->getInput();
        $task  = $input->get('abookisbn_task', '', 'string');

        // Ignorer si ce n'est pas notre requête
        if (empty($task)) return;
		
		
        if ($input->get('option', '') !== 'com_abook') return;

        // Vérifier que l'utilisateur est connecté avec droits admin
        $user = Factory::getUser();
        if (!$user->authorise('core.login.admin')) {
            $this->sendJson(['success' => false, 'error' => 'Accès non autorisé']);
        }

        // Vérification token CSRF
        // APRÈS — compatible Joomla 4 et 5
        $tokenValid = false;

        // Méthode Joomla 5
        if (class_exists('\Joomla\CMS\Session\Session')) {
            $tokenValid = \Joomla\CMS\Session\Session::checkToken('post')
               || \Joomla\CMS\Session\Session::checkToken('request');
        }

        // Fallback Joomla 4 et antérieur
        if (!$tokenValid && class_exists('\JSession')) {
            $tokenValid = \JSession::checkToken('post')
               || \JSession::checkToken('request');
        }

        // Fallback manuel : chercher le token dans POST
        if (!$tokenValid) {
            $session = Factory::getSession();
            $sessionToken = $session->getToken();
            foreach ($_POST as $key => $value) {
                if ($key === $sessionToken && $value === '1') {
                    $tokenValid = true;
                    break;
                }
            }
        }

        if (!$tokenValid) {
            $this->sendJson(['success' => false, 'error' => 'Token CSRF invalide']);
        }

        // Nettoyer le préfixe de la tâche (abookisbn.createAuthor → createAuthor)
        $cleanTask = str_replace('abookisbn.', '', $task);

        // ---------------------------------------------------------
        // Action : création des auteurs en base
        // ---------------------------------------------------------
        if ($cleanTask === 'createAuthor') {

            $authorsJson = trim($input->getString('authors', ''));
            if (empty($authorsJson)) {
                $this->sendJson(['success' => false, 'error' => 'Aucun auteur reçu']);
            }

            $authors = json_decode($authorsJson, true);
            if (!is_array($authors) || empty($authors)) {
                $this->sendJson(['success' => false, 'error' => 'Format auteurs invalide']);
            }

            $results = [];
            foreach ($authors as $fullName) {
                $fullName = trim($fullName);
                if (empty($fullName)) continue;

                // Découpage : dernier mot = lastname, reste = name (prénom)
                // ex: "Jean-Pierre Dupont" → lastname="Dupont", name="Jean-Pierre"
                // ex: "Victor Hugo"        → lastname="Hugo",   name="Victor"
                $parts    = explode(' ', $fullName);
                $lastName = array_pop($parts);
                $firstName = implode(' ', $parts);

                $id        = $this->getOrCreateAuthor($firstName, $lastName, $fullName);
                $results[] = ['id' => $id, 'name' => $fullName];
            }

            $this->sendJson(['success' => true, 'authors' => $results]);
        }

        // ---------------------------------------------------------
        // Action : téléchargement de la couverture
        // ---------------------------------------------------------
        if ($cleanTask === 'downloadCover') {

            $imageUrl = trim($input->getString('url', ''));
            $isbn     = trim($input->getString('isbn', ''));

            if (empty($imageUrl) || empty($isbn)) {
                $this->sendJson(['success' => false, 'error' => 'Paramètres url/isbn manquants']);
            }

            $this->sendJson($this->downloadCover($imageUrl, $isbn));
        }
		
		// ---------------------------------------------------------
        // Action : création de l'éditeur en base
        // ---------------------------------------------------------
        if ($cleanTask === 'createEditor') {

            $editorName = trim($input->getString('editor', ''));
            if (empty($editorName)) {
                $this->sendJson(['success' => false, 'error' => 'Nom éditeur vide']);
            }

            $id = $this->getOrCreateEditor($editorName);
            $this->sendJson(['success' => true, 'id' => $id, 'name' => $editorName]);
        }
		
		// ---------------------------------------------------------
		// Action : récupérer le prochain numéro de catalogue
		// ---------------------------------------------------------
		if ($cleanTask === 'getNextCatalog') {

		    $prefix = strtoupper(trim($input->getString('prefix', '')));

		    // Vérifier que le préfixe est valide (2 lettres exactement)
		    if (!preg_match('/^[A-Z]{2}$/', $prefix)) {
		        $this->sendJson(['success' => false, 'error' => 'Préfixe invalide : ' . $prefix]);
		    }

		    $db = Factory::getDbo();
			
			// DEBUG : informations de connexion
		    $dbPrefix = $db->getPrefix();
		    error_log('ABOOKisbn - Préfixe BDD : ' . $dbPrefix);
		    error_log('ABOOKisbn - Utilisateur BDD : ' . $db->getConnection()->query('SELECT USER()')->fetch_row()[0]);

		    // Chercher tous les numéros de catalogue commençant par ce préfixe
		    // Format attendu : "AG001", "AG002", etc.
		    try {
		        $query = $db->getQuery(true)
		            ->select($db->quoteName('catalogo'))
                    ->from($db->quoteName('#__abbook')) 
                    ->where($db->quoteName('catalogo') . ' LIKE ' . $db->quote($prefix . '%'));

                $db->setQuery($query);
				
				//DEBUG : Récupérer la requête SQL brute avant exécution
				$sqlBrute = $db->replacePrefix((string) $query);
                error_log('ABOOKisbn - Requête SQL : ' . $sqlBrute);
				
                $rows = $db->loadColumn();

            } catch (\Exception $e) {
                error_log('ABOOKisbn - Erreur SQL getNextCatalog : ' . $e->getMessage());
                $this->sendJson([
                    'success' => false,
                    'error'   => 'Erreur SQL : ' . $e->getMessage(),
					// ── DEBUG : renvoyé dans la console F12 ──
					'debug'      => [
					    'sql'       => $db->replacePrefix((string) $query),
						'prefix_db' => $db->getPrefix(),
						'table'     => $db->replacePrefix('#__abbook'),
					]	
                ]);
            }

		    // Extraire le numéro maximum
		    $maxNum = 0;
		    foreach ($rows as $code) {
		        // Extraire la partie numérique après le préfixe
		        $numPart = substr($code, strlen($prefix));
		        if (is_numeric($numPart)) {
		            $maxNum = max($maxNum, (int) $numPart);
		        }
		    }

		    // Formater le prochain numéro sur 3 chiffres minimum (AG001, AG002...)
		    $nextNum  = $maxNum + 1;
		    $nextCode = $prefix . str_pad($nextNum, 3, '0', STR_PAD_LEFT);

		    $this->sendJson([
		        'success'  => true,
		        'prefix'   => $prefix,
		        'next_num' => $nextNum,
		        'code'     => $nextCode,
		    ]);
		}
		
        $this->sendJson(['success' => false, 'error' => 'Tâche inconnue : ' . $task]);
    }

    // =========================================================
    // Envoi d'une réponse JSON et fermeture
    // =========================================================
    private function sendJson($data)
    {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data);
        Factory::getApplication()->close();
    }

    // =========================================================
    // Cherche un auteur dans #__abauthor, le crée s'il n'existe pas
    // Retourne l'ID dans tous les cas
    //
    // Structure de la table #__abauthor :
    //   lastname          → nom de famille
    //   name              → prénom
    //   alias             → slug : lastname-name
    //   checked_out_time  → datetime ex: 2023-11-01 00:00:00
    //   state             → 1 = publié
    //   language          → 'FR'
    // =========================================================
    private function getOrCreateAuthor($firstName, $lastName, $fullName)
    {
        $db = Factory::getDbo();

        // Recherche par lastname + name
        $query = $db->getQuery(true)
            ->select($db->quoteName('id'))
            ->from($db->quoteName('#__abauthor'))
            ->where($db->quoteName('lastname') . ' = ' . $db->quote($lastName))
            ->where($db->quoteName('name')     . ' = ' . $db->quote($firstName));

        $db->setQuery($query);
        $existing = $db->loadResult();

        if ($existing) {
            return (int) $existing;
        }

        // Construire l'alias : lastname-name en minuscules sans accents
        // ex: "Dupont Jean-Pierre" → "dupont-jean-pierre"
        $aliasBase = ApplicationHelper::stringURLSafe(
            strtolower($lastName . '-' . $firstName)
        );

        // Éviter les doublons d'alias
        $aliasQuery = $db->getQuery(true)
            ->select('COUNT(*)')
            ->from($db->quoteName('#__abauthor'))
            ->where($db->quoteName('alias') . ' = ' . $db->quote($aliasBase));
        $db->setQuery($aliasQuery);
        $alias = ((int) $db->loadResult() > 0)
            ? $aliasBase . '-' . time()
            : $aliasBase;

        // Création de l'auteur avec tous les champs obligatoires
        $object = (object) [
            'lastname'         => strtoupper($lastName), //en majuscule
            'name'             => $firstName,
            'alias'            => $alias,
			'image'            => '',
			'description'      => '0',
            'checked_out'      => '0',
            'checked_out_time' => Factory::getDate()->toSql(), // Utilise la date réelle 
			'metakey'          => '',
			'metadesc'         => '',
            'state'            => 1,
            'language'         => 'fr-FR',
        ];

        try {
            $db->insertObject('#__abauthor', $object);
            return (int) $db->insertid();
        } catch (\Exception $e) {
            // Remonter l'erreur SQL pour diagnostic
            $this->sendJson([
                'success' => false,
                'error'   => 'Erreur SQL création auteur : ' . $e->getMessage()
            ]);
        }
    }
	
	// =========================================================
	// Cherche un éditeur dans #__abeditor, le crée s'il n'existe pas
	// Retourne l'ID dans tous les cas
	//
	// Structure de la table #__abeditor :
	//   name              → nom de l'éditeur
	//   alias             → laisser vide
	//   description       → '0'
	//   checked_out       → 0
	//   checked_out_time  → date et heure du jour
	//   metakey           → laisser vide
	//   metadesc          → laisser vide
	//   state             → 1
	//   language          → 'FR'
	// =========================================================
	private function getOrCreateEditor($editorName)
	{
	    $db = Factory::getDbo();

	    // Recherche par name
	    $query = $db->getQuery(true)
	        ->select($db->quoteName('id'))
	        ->from($db->quoteName('#__abeditor'))
	        ->where($db->quoteName('name') . ' = ' . $db->quote($editorName));

	    $db->setQuery($query);
	    $existing = $db->loadResult();

	    if ($existing) {
	        return (int) $existing;
	    }

	    // Création de l'éditeur
	    $object = (object) [
	        'name'             => $editorName,
	        'alias'            => '',
	        'description'      => '0',
	        'checked_out'      => 0,
	        'checked_out_time' => Factory::getDate()->toSql(),
	        'metakey'          => '',
	        'metadesc'         => '',
	        'state'            => 1,
	        'language'         => 'fr-FR',
	    ];

	    try {
	        $db->insertObject('#__abeditor', $object);
	        return (int) $db->insertid();
	    } catch (\Exception $e) {
	        $this->sendJson([
	            'success' => false,
	            'error'   => 'Erreur SQL création éditeur : ' . $e->getMessage()
	        ]);
	    }
	}

    // =========================================================
    // Télécharge la couverture depuis l'URL Google Books
    // et la sauvegarde dans /images/abook/covers/
    // =========================================================
    private function downloadCover($imageUrl, $isbn)
    {
        $uploadDir  = JPATH_ROOT . '/images/abook/covers/';
        $fileName   = 'cover_' . preg_replace('/[^a-zA-Z0-9]/', '', $isbn) . '.jpg';
        $targetPath = $uploadDir . $fileName;

        // Créer le dossier si nécessaire
        if (!is_dir($uploadDir)) {
            if (!mkdir($uploadDir, 0755, true)) {
                return ['success' => false, 'error' => 'Impossible de créer le dossier ' . $uploadDir];
            }
        }

        if (!is_writable($uploadDir)) {
            return ['success' => false, 'error' => 'Dossier non accessible en écriture : ' . $uploadDir];
        }

        if (!function_exists('curl_init')) {
            return ['success' => false, 'error' => 'cURL non disponible sur ce serveur'];
        }

        // Téléchargement via cURL
        $ch = curl_init($imageUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; JoomlaPlugin/1.0)',
        ]);
        $imageData = curl_exec($ch);
        $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            return ['success' => false, 'error' => 'Erreur cURL : ' . $curlError];
        }
        if (!$imageData || $httpCode !== 200) {
            return ['success' => false, 'error' => 'Téléchargement échoué (HTTP ' . $httpCode . ')'];
        }

        // Vérifier que c'est bien une image
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime  = $finfo->buffer($imageData);
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'])) {
            return ['success' => false, 'error' => 'Format image invalide : ' . $mime];
        }

        if (file_put_contents($targetPath, $imageData) === false) {
            return ['success' => false, 'error' => 'Impossible d\'écrire le fichier image'];
        }

        return [
            'success'  => true,
            'path'     => 'images/abook/covers/' . $fileName,
            'filename' => $fileName,
        ];
    }
}
