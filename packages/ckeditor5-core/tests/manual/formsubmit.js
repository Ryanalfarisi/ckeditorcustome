/**
 * @license Copyright (c) 2003-2017, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/* globals console, window, document */

import ClassicEditor from '@ckeditor/ckeditor5-editor-classic/src/classiceditor';
import ArticlePreset from '@ckeditor/ckeditor5-presets/src/article';

// Replace original submit method to prevent page reload.
document.getElementById( 'form' ).submit = () => {};

ClassicEditor
	.create( document.querySelector( '#editor' ), {
		plugins: [ ArticlePreset ],
		toolbar: [ 'bold', 'italic', 'undo', 'redo' ],
	} )
	.then( editor => {
		window.editor = editor;
		const form = document.getElementById( 'form' );

		document.getElementById( 'submit-with-js' ).addEventListener( 'click', () => {
			form.submit();
		} );

		form.addEventListener( 'submit', evt => {
			evt.preventDefault();
		} );
	} )
	.catch( err => {
		console.error( err.stack );
	} );
