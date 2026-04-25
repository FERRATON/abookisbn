/**
 * isbn_lookup.js
 * Récupération automatique des métadonnées ISBN pour Alexandria Book Library
 * Dépend de : plugin plg_system_abookisbn (onAfterRoute)
 */
document.addEventListener('DOMContentLoaded', function () {

    // ── Vérifier qu'on est bien sur un formulaire Alexandria ──
    const isbnField = document.getElementById('jform_isbn');
    if (!isbnField) return;

    // ── Créer le bouton de recherche ──────────────────────────
    const btn = document.createElement('button');
    btn.type          = 'button';
    btn.textContent   = '🔍 Récupérer via ISBN';
    btn.className     = 'btn btn-small btn-info';
    btn.style.cssText = 'margin-left:10px; vertical-align:middle;';
    isbnField.parentNode.appendChild(btn);

    // ── Créer la zone de notification ────────────────────────
    const notif = document.createElement('div');
    notif.style.cssText = [
        'display:none',
        'margin-top:14px',
        'padding:14px 18px',
        'border-radius:5px',
        'font-size:13px',
        'line-height:1.8',
        'border:1px solid transparent'
    ].join(';');

    // Insérer la notification après le groupe de champ ISBN
    const isbnGroup = isbnField.closest('.control-group')
                   || isbnField.closest('.row')
                   || isbnField.parentNode;
    isbnGroup.parentNode.insertBefore(notif, isbnGroup.nextSibling);
	
	// =========================================================
	// Mapping catégories → préfixes de catalogue
	// =========================================================
	const CATALOG_PREFIXES = {
	    'Astronomie générale'    : 'AG',
	    'Astronomie Informatique': 'AI',
	    'Astronautique'          : 'AN',
	    'Astronomie Pratique'    : 'AP',
	    'Astronomie Spécialisée' : 'AS',
	    'Cassette audio'         : 'CA',
	    'Cassette video'         : 'CD',
	    'Cédérom'                : 'CV',
	    'Divers'                 : 'DV',
	    'Histoire'               : 'HI',
	    'Jeunesse'               : 'JE',
	    'Astrophysique'          : 'PH',
	    'Astrophotographie'      : 'PT',
	    'Romans'                 : 'RO',
	    'Documents SAN'          : 'SA',
	    'Thèses'                 : 'TH',
	    'Bandes Dessinées'       : 'BD',
	};

	// =========================================================
	// Listener sur le champ catégorie
	// Déclenche le calcul du prochain numéro de catalogue
	// =========================================================
	const categoryField = document.getElementById('jform_catid')
                   || document.getElementById('jform_category_id');

	if (categoryField) {
	    categoryField.addEventListener('change', async function () {

	        // Récupérer le texte de l'option sélectionnée
	        const selectedText = categoryField.options[categoryField.selectedIndex]?.text?.trim() || '';
	        if (!selectedText) return;

	        // Chercher si cette catégorie a un préfixe connu
	        // Recherche exacte d'abord, puis recherche partielle (insensible à la casse)
	        let prefix = CATALOG_PREFIXES[selectedText];

	        if (!prefix) {
	            // Recherche partielle : "Astronomie générale" dans "09 - Astronomie générale"
	            for (const [catName, pre] of Object.entries(CATALOG_PREFIXES)) {
	                if (selectedText.toLowerCase().includes(catName.toLowerCase())) {
	                    prefix = pre;
	                    break;
	                }
	            }
	        }

	        if (!prefix) {
	            console.log('[abookisbn] Catégorie sans préfixe connu :', selectedText);
 	            return;
	        }

	        console.log('[abookisbn] Catégorie sélectionnée :', selectedText, '→ préfixe :', prefix);

	        // Indiquer visuellement que le calcul est en cours
	        const catalogField = document.getElementById('jform_catalogo');
	        if (catalogField) {
	            catalogField.value       = '⏳ Calcul…';
	            catalogField.disabled    = true;
	            catalogField.style.color = '#999';
	        }

	        try {
	            const result = await serverAction('abookisbn.getNextCatalog', { prefix });

	            if (result.success) {
	                if (catalogField) {
	                    catalogField.value       = result.code;
	                    catalogField.disabled    = false;
	                    catalogField.style.color = '';
	                    catalogField.dispatchEvent(new Event('change', { bubbles: true }));
	                    console.log('[abookisbn] Numéro catalogue calculé :', result.code);
						// Pour les besoin de la bibliothèque SAN on duplique dans le champs jform_note
						setField('jform_note',    result.code     || '');
	                }
	            } else {
	                console.warn('[abookisbn] Erreur calcul catalogue :', result.error);
	                if (catalogField) {
	                    catalogField.value    = '';
	                    catalogField.disabled = false;
	                    catalogField.style.color = '';
	                }
	            }

	        } catch (e) {
	            console.error('[abookisbn] Erreur AJAX catalogue :', e.message);
	            if (catalogField) {
	                catalogField.value    = '';
	                catalogField.disabled = false;
	                catalogField.style.color = '';
	            }
	        }
	    });

	} else {
	    console.warn('[abookisbn] Champ catégorie introuvable (jform_catid / jform_category_id)');
	}

    // =========================================================
    // Clic sur le bouton
    // =========================================================
    btn.addEventListener('click', async function () {

        const isbn = isbnField.value.trim().replace(/[-\s]/g, '');

        if (!isbn) {
            showNotif('warning', '⚠️ Veuillez saisir un ISBN avant de lancer la recherche.');
            return;
        }

        // Vérification format ISBN (10 ou 13 chiffres)
        if (!/^\d{10}(\d{3})?$/.test(isbn)) {
            showNotif('warning', '⚠️ Format ISBN invalide (10 ou 13 chiffres attendus).');
            return;
        }

        showNotif('info', '⏳ Interrogation de Google Books…');
        btn.disabled    = true;
        btn.textContent = '⏳ Recherche…';

        try {
            // =================================================
            // 1. Appel API Google Books
            // =================================================
            // Ajouter votre clef d'API google
			const gbResponse = await fetch(
                `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`
            );

            if (!gbResponse.ok) {
                throw new Error('Google Books API non disponible (HTTP ' + gbResponse.status + ')');
            }

            const gbData = await gbResponse.json();

            if (!gbData.items || gbData.items.length === 0) {
                showNotif('warning', '❌ Aucun livre trouvé pour l\'ISBN <strong>' + isbn + '</strong>.');
                return;
            }

            const info = gbData.items[0].volumeInfo;

            // =================================================
            // 2. Remplissage des champs 
            // =================================================
            setField('jform_title',    info.title     || '');
            setField('jform_subtitle', info.subtitle  || '');
            setField('jform_year',     info.publishedDate
                                       ? info.publishedDate.substring(0, 4) : '');
            setField('jform_pag',      info.pageCount || '');
            // Le champ éditeur est traité après création en BDD (section 4bis)
            const publisherName = info.publisher || '';

            // Description via l'API JoomlaEditor (éditeur WYSIWYG)
            if (info.description) {
                try {
                    JoomlaEditor.get('jform_description').setValue(String(info.description));
                } catch (e) {
                    // Fallback si JoomlaEditor n'est pas disponible
                    setField('jform_description', info.description);
                }
            }

            // =================================================
            // 3. Couverture : téléchargement côté serveur
            // =================================================
            let coverMsg = '';
            const coverUrl = info.imageLinks?.thumbnail
                          || info.imageLinks?.smallThumbnail
                          || '';

            if (coverUrl) {
                showNotif('info', '⏳ Téléchargement de la couverture…');
                try {
                    const coverResult = await serverAction('abookisbn.downloadCover', {
                        url:  coverUrl,
                        isbn: isbn
                    });
                    if (coverResult.success) {
                        setImageField('jform_image', coverResult.path);
                        coverMsg = `🖼️ Couverture enregistrée : <code>${coverResult.filename}</code>`;
                    } else {
                        coverMsg = `⚠️ Couverture non récupérée : ${coverResult.error}`;
                    }
                } catch (e) {
                    coverMsg = `⚠️ Erreur couverture : ${e.message}`;
                }
            } else {
                coverMsg = '⚠️ Aucune image de couverture disponible pour ce livre.';
            }
			
			// =================================================
            // 4bis. Éditeur : création en BDD + sélection
            // =================================================
            let editorMsg = '';

            if (publisherName) {
                showNotif('info', '⏳ Vérification de l\'éditeur en base…');
                try {
                    const editorResult = await serverAction('abookisbn.createEditor', {
                        editor: publisherName
                    });

                    if (editorResult.success) {

                        // Tenter d'alimenter le menu déroulant jform_editor
                        const editorSelect = document.getElementById('jform_ideditor');

                        if (editorSelect) {
                            // Cas select standard (option list)
                            if (!Array.from(editorSelect.options).some(o => String(o.value) === String(editorResult.id))) {
                                editorSelect.appendChild(new Option(editorResult.name, editorResult.id));
                            }
                            editorSelect.value = String(editorResult.id);
                            editorSelect.dispatchEvent(new Event('change', { bubbles: true }));

                            // Mise à jour si joomla-field-fancy-select
                            const fancy = editorSelect.closest('joomla-field-fancy-select');
                            if (fancy) {
                                const choices = fancy.choicesInstance;
                                if (choices) {
                                    const existingChoices = choices._store?.choices || [];
                                    const alreadyThere = existingChoices.some(
                                        c => String(c.value) === String(editorResult.id)
                                    );
                                    if (!alreadyThere) {
                                        choices.setChoices(
                                            [{ value: String(editorResult.id), label: editorResult.name, selected: true }],
                                            'value', 'label', false
                                        );
                                    } else {
                                        choices.setChoiceByValue(String(editorResult.id));
                                    }
                                    console.log('[abookisbn] Éditeur sélectionné via Choices.js :', editorResult.name);
                                } else {
                                    // Fallback : reconnexion DOM du Web Component
                                    const parent      = fancy.parentNode;
                                    const nextSibling = fancy.nextSibling;
                                    parent.removeChild(fancy);
                                    parent.insertBefore(fancy, nextSibling);
                                }
                            }

                            // Mise à jour Chosen.js (Joomla 3/4)
                            if (window.jQuery && jQuery(editorSelect).data('chosen')) {
                                jQuery(editorSelect).trigger('chosen:updated');
                            }

                            editorMsg = `🏢 Éditeur enregistré : <strong>${editorResult.name}</strong> (ID ${editorResult.id})`;

                        } else {
                            // Pas de select trouvé : remplir le champ texte simple en fallback
                            setField('jform_editor', editorResult.name);
                            editorMsg = `🏢 Éditeur renseigné : <strong>${editorResult.name}</strong>`;
                            console.warn('[abookisbn] jform_editor : select introuvable, champ texte utilisé en fallback');
                        }

                    } else {
                        editorMsg = `⚠️ Éditeur non créé : ${editorResult.error}`;
                    }

                } catch (e) {
                    editorMsg = `⚠️ Erreur éditeur : ${e.message}`;
                    // Fallback : remplir le champ texte directement
                    setField('jform_editor', publisherName);
                }

            } else {
                editorMsg = '⚠️ Aucun éditeur trouvé dans les métadonnées.';
            }

            // =================================================
            // 4. Auteurs : normalisation + envoi groupé en BDD
            // =================================================
            let authorMsg = '';

            // Normaliser en tableau propre (tableau, chaîne unique, ou absent)
            const rawAuthors  = info.authors;
            const authorsList = Array.isArray(rawAuthors)
                ? rawAuthors.map(a => String(a).trim()).filter(a => a.length > 0)
                : (rawAuthors ? [String(rawAuthors).trim()] : []);


            if (authorsList.length > 0) {
                showNotif('info', `⏳ Enregistrement de ${authorsList.length} auteur(s) en base…`);

                try {
                    const authorResult = await serverAction('abookisbn.createAuthor', {
                        authors: JSON.stringify(authorsList)
                    });

                    if (authorResult.success && Array.isArray(authorResult.authors)) {
                        // --- INJECTION DANS LE SOUS-FORMULAIRE JOOMLA 5 ---
                        // Alexandria utilise un subform repeatable avec joomla-field-fancy-select
                        const subformTable = document.getElementById('subfieldList_jform_authorlist');

                        if (subformTable) {
                            const addButton = subformTable.querySelector('.group-add');

                            for (const author of authorResult.authors) {

                                // 1. Ajouter une ligne vide via le bouton "+"
                                if (addButton) addButton.click();

                                // 2. Attendre que Joomla injecte le HTML + initialise le Web Component
                                await new Promise(resolve => setTimeout(resolve, 800));

                                // 3. Cibler le dernier select __idauth créé
                                const selects    = subformTable.querySelectorAll('select[id$="__idauth"]');
                                const lastSelect = selects[selects.length - 1];

                                if (!lastSelect) {
                                    console.warn('[abookisbn] Select idauth introuvable après ajout ligne');
                                    continue;
                                }

                                // 4. Remonter au Web Component joomla-field-fancy-select
                                const fancy = lastSelect.closest('joomla-field-fancy-select');

                                if (fancy) {
                                    // ── Méthode 1 : via l'instance Choices.js interne ──────────
                                    // Joomla 5 stocke l'instance dans fancy.choicesInstance
                                    const choices = fancy.choicesInstance;

                                    if (choices) {
                                        // Ajouter l'option à Choices.js si absente
                                        const existingChoices = choices._store?.choices || [];
                                        const alreadyThere = existingChoices.some(
                                            c => String(c.value) === String(author.id)
                                        );
                                        if (!alreadyThere) {
                                            choices.setChoices(
                                                [{ value: String(author.id), label: author.name, selected: true }],
                                                'value', 'label', false
                                            );
                                        } else {
                                            choices.setChoiceByValue(String(author.id));
                                        }
                                        console.log('[abookisbn] Auteur sélectionné via Choices.js :', author.name);

                                    } else {
                                        // ── Méthode 2 : manipulation directe + reconnexion DOM ──
                                        console.warn('[abookisbn] choicesInstance absent, manipulation directe');

                                        if (!Array.from(lastSelect.options).some(o => String(o.value) === String(author.id))) {
                                            const opt = new Option(author.name, author.id, true, true);
                                            lastSelect.appendChild(opt);
                                        }
                                        lastSelect.value = String(author.id);

                                        // Déclencher change pour synchroniser le Web Component
                                        lastSelect.dispatchEvent(new Event('change', { bubbles: true }));

                                        // Forcer le re-render en reconnectant le Web Component au DOM
                                        const parent      = fancy.parentNode;
                                        const nextSibling = fancy.nextSibling;
                                        parent.removeChild(fancy);
                                        parent.insertBefore(fancy, nextSibling);
                                    }

                                } else {
                                    // ── Méthode 3 : select standard (Joomla 3/4 / Chosen.js) ──
                                    console.warn('[abookisbn] Pas de fancy-select, select standard');
                                    if (!Array.from(lastSelect.options).some(o => String(o.value) === String(author.id))) {
                                        lastSelect.appendChild(new Option(author.name, author.id));
                                    }
                                    lastSelect.value = String(author.id);
                                    lastSelect.dispatchEvent(new Event('change', { bubbles: true }));
                                    if (window.jQuery && jQuery(lastSelect).data('chosen')) {
                                        jQuery(lastSelect).trigger('chosen:updated');
                                    }
                                }
                            }

                        } else {
                            console.warn("[abookisbn] subfieldList_jform_authorlist introuvable — vérifiez l'ID avec F12");
                        }
                        // --- FIN INJECTION ---

                        const lines  = authorResult.authors.map(a => `<strong>${a.name}</strong> (ID ${a.id})`);
                        const plural = authorResult.authors.length > 1 ? 's' : '';
                        authorMsg = `👤 Auteur${plural} enregistré${plural} :<br>&nbsp;&nbsp;• `
                                  + lines.join('<br>&nbsp;&nbsp;• ');
                    }
                } catch (e) {
                    authorMsg = `⚠️ Erreur auteurs : ${e.message}`;
                }
            } else {
                authorMsg = '⚠️ Aucun auteur trouvé dans les métadonnées.';
            }

            // =================================================
            // 5. Message récapitulatif final
            // =================================================
            const title = info.title
                ? `« <strong>${info.title}</strong> »`
                : `ISBN <strong>${isbn}</strong>`;

            showNotif('success',
                `✅ Métadonnées importées pour ${title}<br><br>`
				+ editorMsg
                + `<br><br>`
                + authorMsg
                + `<br><br>`
                + coverMsg
            );

        } catch (err) {
            showNotif('danger',
                `❌ Erreur inattendue : ${err.message}<br>`
                + `<small>Consultez la console (F12) pour plus de détails.</small>`
            );
            console.error('[abookisbn]', err);

        } finally {
            btn.disabled    = false;
            btn.textContent = '🔍 Récupérer via ISBN';
        }
    });

    // =========================================================
    // Appel AJAX vers le plugin PHP via onAfterRoute
    // Utilise l'URL courante du backend pour partager la session
    // =========================================================
    async function serverAction(task, params) {

        const formData = new FormData();
        formData.append('option',         'com_abook');
        formData.append('abookisbn_task', task);

        for (const [key, val] of Object.entries(params)) {
            formData.append(key, val);
        }

        // Token CSRF Joomla
        const csrfToken = getCsrfToken();
        if (csrfToken) {
            formData.append(csrfToken, '1');
        } else {
            console.warn('[abookisbn] Token CSRF introuvable');
        }

        // window.location.pathname contient le chemin backend complet
        // ex: /test/administrator/index.php
        const ajaxUrl = window.location.origin
                      + window.location.pathname
                      + '?option=com_abook'
                      + '&abookisbn_task=' + encodeURIComponent(task)
                      + '&tmpl=component'
                      + '&format=json';

        console.log('[abookisbn] URL :', ajaxUrl);

        const response = await fetch(ajaxUrl, {
            method:      'POST',
            body:        formData,
            credentials: 'same-origin',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
            }
        });

        const raw = await response.text();
        console.log('[abookisbn] Status :', response.status);
        console.log('[abookisbn] Réponse brute :', raw.substring(0, 500));

        if (!response.ok) {
			// Afficher la réponse brute pour diagnostiquer le 500
            console.error('[abookisbn] Contenu erreur serveur :', raw.substring(0, 800)); // a supprimer quand OK
            throw new Error('Erreur HTTP ' + response.status);
        }

        try {
            return JSON.parse(raw);
        } catch (e) {
            console.error('[abookisbn] Réponse non-JSON :', raw.substring(0, 300));
            throw new Error('Réponse non-JSON : ' + raw.substring(0, 100));
        }
    }

    // =========================================================
    // Utilitaires
    // =========================================================

    /**
     * Remplir un champ image et rafraîchir le preview
     * Gère les 3 cas possibles selon la version de Joomla / Alexandria :
     *   1. Joomla 5 : Web Component joomla-field-media
     *   2. Joomla 4 : champ input + img#[id]_preview standard
     *   3. Fallback : simple update de la valeur + img adjacente
     */
    function setImageField(id, path) {

        const input = document.getElementById(id);
        if (!input) {
            console.warn('[abookisbn] Champ image introuvable :', id);
            return;
        }

        // ── Cas 1 : Web Component joomla-field-media (Joomla 5) ──────────────
        const mediaComponent = input.closest('joomla-field-media')
                            || document.querySelector('joomla-field-media');

        if (mediaComponent) {
            console.log('[abookisbn] Champ image : joomla-field-media détecté');

            // Mettre à jour la valeur du champ caché/texte interne
            input.value = path;
            input.dispatchEvent(new Event('change', { bubbles: true }));

            // Mettre à jour l'aperçu image dans le Web Component
            // joomla-field-media expose une propriété "value" et gère le preview en interne
            if (typeof mediaComponent.setValue === 'function') {
                mediaComponent.setValue(path);
            } else {
                // Forcer la mise à jour via l'attribut value du Web Component
                mediaComponent.setAttribute('value', path);

                // Mettre à jour manuellement l'img de preview si présente dans le shadow DOM
                // ou dans le DOM classique (Joomla 5 n'utilise pas de Shadow DOM pour ce composant)
                const preview = mediaComponent.querySelector('img')
                             || mediaComponent.querySelector('.media-preview img')
                             || mediaComponent.querySelector('[data-preview]');

                if (preview) {
                    preview.src = path.startsWith('http') ? path : (window.location.origin + '/' + path);
                    preview.style.display = 'block';
                    console.log('[abookisbn] Preview joomla-field-media mise à jour');
                }

                // Déclencher l'événement interne de mise à jour du Web Component
                mediaComponent.dispatchEvent(new CustomEvent('change', {
                    bubbles: true,
                    detail:  { value: path }
                }));
            }
            return;
        }

        // ── Cas 2 : Champ image Joomla 4 standard ────────────────────────────
        // Structure : <input id="jform_image"> + <img id="jform_image_preview">
        input.value = path;
        input.dispatchEvent(new Event('change', { bubbles: true }));

        const previewId = id + '_preview';
        let   previewEl = document.getElementById(previewId);

        if (!previewEl) {
            // Chercher une img adjacente ou dans le même groupe de champ
            const group = input.closest('.control-group, .row, div');
            previewEl   = group ? group.querySelector('img') : null;
        }

        if (previewEl) {
            const src = path.startsWith('http') ? path : (window.location.origin + '/' + path);
            previewEl.src          = src;
            previewEl.style.display = 'block';
            previewEl.style.maxWidth = '150px';
            console.log('[abookisbn] Preview Joomla 4 mise à jour :', src);
            return;
        }

        // ── Cas 3 : Fallback — créer un aperçu si aucun n'existe ─────────────
        console.warn(`[abookisbn] Aucun élément preview trouvé, création d'un aperçu manuel`);

        const existingPreview = document.getElementById(id + '_abookisbn_preview');
        if (existingPreview) existingPreview.remove();

        const img       = document.createElement('img');
        img.id          = id + '_abookisbn_preview';
        img.src         = path.startsWith('http') ? path : (window.location.origin + '/' + path);
        img.alt         = 'Couverture';
        img.style.cssText = 'max-width:120px; max-height:180px; margin-top:8px; border:1px solid #ddd; border-radius:4px; display:block;';
        input.parentNode.insertBefore(img, input.nextSibling);
    }

    function setField(id, value) {
        const el = document.getElementById(id);
        if (el && value !== '' && value !== undefined && value !== null) {
            el.value = value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /**
     * Afficher une notification colorée
     * @param {string} type  'success' | 'info' | 'warning' | 'danger'
     * @param {string} html  Contenu HTML du message
     */
    function showNotif(type, html) {
        const styles = {
            success: { bg: '#d4edda', border: '#c3e6cb', color: '#155724' },
            info:    { bg: '#d1ecf1', border: '#bee5eb', color: '#0c5460' },
            warning: { bg: '#fff3cd', border: '#ffeeba', color: '#856404' },
            danger:  { bg: '#f8d7da', border: '#f5c6cb', color: '#721c24' },
        };
        const s = styles[type] || styles.info;
        Object.assign(notif.style, {
            display:     'block',
            background:  s.bg,
            borderColor: s.border,
            color:       s.color,
        });
        notif.innerHTML = html;
        notif.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Retrouver le token CSRF Joomla dans la page
     * Le token est un input hidden dont le name est un hash MD5 et la value est "1"
     */
    function getCsrfToken() {
        // Méthode officielle Joomla 4/5
        if (window.Joomla?.getOptions) {
            const t = Joomla.getOptions('csrf.token');
            if (t) return t;
        }
        // Fallback : parcourir les champs cachés du formulaire admin
        const form = document.getElementById('adminForm')
                  || document.querySelector('form');
        if (form) {
            for (const input of form.querySelectorAll('input[type="hidden"]')) {
                if (/^[a-f0-9]{32}$/.test(input.name) && input.value === '1') {
                    return input.name;
                }
            }
        }
        // Dernier recours : chercher dans toute la page
        for (const input of document.querySelectorAll('input[type="hidden"]')) {
            if (/^[a-f0-9]{32}$/.test(input.name) && input.value === '1') {
                return input.name;
            }
        }
        return null;
    }

});
