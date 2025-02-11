/**
 * @license Copyright (c) 2003-2022, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/* globals window */

/**
 * @module ckbox/ckboxediting
 */

import { Plugin } from 'ckeditor5/src/core';
import { Range } from 'ckeditor5/src/engine';
import { CKEditorError, logError } from 'ckeditor5/src/utils';

import CKBoxCommand from './ckboxcommand';
import CKBoxUploadAdapter from './ckboxuploadadapter';

/**
 * The CKBox editing feature. It introduces the {@link module:ckbox/ckboxcommand~CKBoxCommand CKBox command} and
 * {@link module:ckbox/ckboxuploadadapter~CKBoxUploadAdapter CKBox upload adapter}.
 *
 * @extends module:core/plugin~Plugin
 */
export default class CKBoxEditing extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'CKBoxEditing';
	}

	/**
	 * @inheritDoc
	 */
	static get requires() {
		return [ 'CloudServicesCore', 'LinkEditing', 'PictureEditing', CKBoxUploadAdapter ];
	}

	/**
	 * @inheritDoc
	 */
	async init() {
		const editor = this.editor;
		const hasConfiguration = !!editor.config.get( 'ckbox' );
		const isLibraryLoaded = !!window.CKBox;

		// Proceed with plugin initialization only when the integrator intentionally wants to use it, i.e. when the `config.ckbox` exists or
		// the CKBox JavaScript library is loaded.
		if ( !hasConfiguration && !isLibraryLoaded ) {
			return;
		}

		this._initConfig();

		const cloudServicesCore = editor.plugins.get( 'CloudServicesCore' );
		const ckboxTokenUrl = editor.config.get( 'ckbox.tokenUrl' );
		const cloudServicesTokenUrl = editor.config.get( 'cloudServices.tokenUrl' );

		// To avoid fetching the same token twice we need to compare the `ckbox.tokenUrl` and `cloudServices.tokenUrl` values.
		// If they are equal, it's enough to take the token generated by the `CloudServices` plugin.
		if ( ckboxTokenUrl === cloudServicesTokenUrl ) {
			/**
			 * CKEditor Cloud Services access token.
			 *
			 * @protected
			 * @member {module:cloud-services/token~Token} #_token
			 */
			this._token = editor.plugins.get( 'CloudServices' ).token;
		}
		// Otherwise, create a new token manually.
		else {
			this._token = await cloudServicesCore.createToken( ckboxTokenUrl ).init();
		}

		// Extending the schema, registering converters and applying fixers only make sense if the configuration option to assign
		// the assets ID with the model elements is enabled.
		if ( !editor.config.get( 'ckbox.ignoreDataId' ) ) {
			this._initSchema();
			this._initConversion();
			this._initFixers();
		}

		// Registering the `ckbox` command makes sense only if the CKBox library is loaded, as the `ckbox` command opens the CKBox dialog.
		if ( isLibraryLoaded ) {
			editor.commands.add( 'ckbox', new CKBoxCommand( editor ) );
		}
	}

	/**
	 * Returns a token used by the CKBox plugin for communication with the CKBox service.
	 *
	 * @returns {module:cloud-services/token~Token}
	 */
	getToken() {
		return this._token;
	}

	/**
	 * Initializes the `ckbox` editor configuration.
	 *
	 * @private
	 */
	_initConfig() {
		const editor = this.editor;

		editor.config.define( 'ckbox', {
			serviceOrigin: 'https://api.ckbox.io',
			defaultUploadCategories: null,
			ignoreDataId: false,
			language: editor.locale.uiLanguage,
			theme: 'default',
			tokenUrl: editor.config.get( 'cloudServices.tokenUrl' )
		} );

		const tokenUrl = editor.config.get( 'ckbox.tokenUrl' );

		if ( !tokenUrl ) {
			/**
			 * The {@link module:ckbox/ckbox~CKBoxConfig#tokenUrl `config.ckbox.tokenUrl`} or the
			 * {@link module:cloud-services/cloudservices~CloudServicesConfig#tokenUrl `config.cloudServices.tokenUrl`}
			 * configuration is required for the CKBox plugin.
			 *
			 * 		ClassicEditor.create( document.createElement( 'div' ), {
			 * 			ckbox: {
			 * 				tokenUrl: "YOUR_TOKEN_URL"
			 * 				// ...
			 *			}
			 *			// ...
			 * 		} );
			 *
			 * @error ckbox-plugin-missing-token-url
			 */
			throw new CKEditorError( 'ckbox-plugin-missing-token-url', this );
		}

		if ( !editor.plugins.has( 'ImageBlockEditing' ) && !editor.plugins.has( 'ImageInlineEditing' ) ) {
			/**
			 * The CKBox feature requires one of the following plugins to be loaded to work correctly:
			 *
			 * * {@link module:image/imageblock~ImageBlock},
			 * * {@link module:image/imageinline~ImageInline},
			 * * {@link module:image/image~Image} (loads both `ImageBlock` and `ImageInline`)
			 *
			 * Please make sure your editor configuration is correct.
			 *
			 * @error ckbox-plugin-image-feature-missing
			 * @param {module:core/editor/editor~Editor} editor
			 */
			logError( 'ckbox-plugin-image-feature-missing', editor );
		}
	}

	/**
	 * Extends the schema to allow the `ckboxImageId` and `ckboxLinkId` attributes for links and images.
	 *
	 * @private
	 */
	_initSchema() {
		const editor = this.editor;
		const schema = editor.model.schema;

		schema.extend( '$text', { allowAttributes: 'ckboxLinkId' } );

		if ( schema.isRegistered( 'imageBlock' ) ) {
			schema.extend( 'imageBlock', { allowAttributes: [ 'ckboxImageId', 'ckboxLinkId' ] } );
		}

		if ( schema.isRegistered( 'imageInline' ) ) {
			schema.extend( 'imageInline', { allowAttributes: [ 'ckboxImageId', 'ckboxLinkId' ] } );
		}

		schema.addAttributeCheck( ( context, attributeName ) => {
			const isLink = !!context.last.getAttribute( 'linkHref' );

			if ( !isLink && attributeName === 'ckboxLinkId' ) {
				return false;
			}
		} );
	}

	/**
	 * Configures the upcast and downcast conversions for the `ckboxImageId` and `ckboxLinkId` attributes.
	 *
	 * @private
	 */
	_initConversion() {
		const editor = this.editor;

		// Convert `ckboxLinkId` => `data-ckbox-resource-id`.
		editor.conversion.for( 'downcast' ).add( dispatcher => {
			// Due to custom converters for linked block images, handle the `ckboxLinkId` attribute manually.
			dispatcher.on( 'attribute:ckboxLinkId:imageBlock', ( evt, data, conversionApi ) => {
				const { writer, mapper, consumable } = conversionApi;

				if ( !consumable.consume( data.item, evt.name ) ) {
					return;
				}

				const viewFigure = mapper.toViewElement( data.item );
				const linkInImage = [ ...viewFigure.getChildren() ].find( child => child.name === 'a' );

				// No link inside an image - no conversion needed.
				if ( !linkInImage ) {
					return;
				}

				if ( data.item.hasAttribute( 'ckboxLinkId' ) ) {
					writer.setAttribute( 'data-ckbox-resource-id', data.item.getAttribute( 'ckboxLinkId' ), linkInImage );
				} else {
					writer.removeAttribute( 'data-ckbox-resource-id', linkInImage );
				}
			}, { priority: 'low' } );

			dispatcher.on( 'attribute:ckboxLinkId', ( evt, data, conversionApi ) => {
				const { writer, mapper, consumable } = conversionApi;

				if ( !consumable.consume( data.item, evt.name ) ) {
					return;
				}

				// Remove the previous attribute value if it was applied.
				if ( data.attributeOldValue ) {
					const viewElement = createLinkElement( writer, data.attributeOldValue );

					writer.unwrap( mapper.toViewRange( data.range ), viewElement );
				}

				// Add the new attribute value if specified in a model element.
				if ( data.attributeNewValue ) {
					const viewElement = createLinkElement( writer, data.attributeNewValue );

					if ( data.item.is( 'selection' ) ) {
						const viewSelection = writer.document.selection;

						writer.wrap( viewSelection.getFirstRange(), viewElement );
					} else {
						writer.wrap( mapper.toViewRange( data.range ), viewElement );
					}
				}
			}, { priority: 'low' } );
		} );

		// Convert `data-ckbox-resource-id` => `ckboxLinkId`.
		//
		// The helper conversion does not handle all cases, so take care of the `data-ckbox-resource-id` attribute manually for images
		// and links.
		editor.conversion.for( 'upcast' ).add( dispatcher => {
			dispatcher.on( 'element:a', ( evt, data, conversionApi ) => {
				const { writer, consumable } = conversionApi;

				// Upcast the `data-ckbox-resource-id` attribute only for valid link elements.
				if ( !data.viewItem.getAttribute( 'href' ) ) {
					return;
				}

				const consumableAttributes = { attributes: [ 'data-ckbox-resource-id' ] };

				if ( !consumable.consume( data.viewItem, consumableAttributes ) ) {
					return;
				}

				const attributeValue = data.viewItem.getAttribute( 'data-ckbox-resource-id' );

				// Missing the `data-ckbox-resource-id` attribute.
				if ( !attributeValue ) {
					return;
				}

				if ( data.modelRange ) {
					// If the `<a>` element contains more than single children (e.g. a linked image), set the `ckboxLinkId` for each
					// allowed child.
					for ( let item of data.modelRange.getItems() ) {
						if ( item.is( '$textProxy' ) ) {
							item = item.textNode;
						}

						// Do not copy the `ckboxLinkId` attribute when wrapping an element in a block element, e.g. when
						// auto-paragraphing.
						if ( shouldUpcastAttributeForNode( item ) ) {
							writer.setAttribute( 'ckboxLinkId', attributeValue, item );
						}
					}
				} else {
					// Otherwise, just set the `ckboxLinkId` for the model element.
					const modelElement = data.modelCursor.nodeBefore || data.modelCursor.parent;

					writer.setAttribute( 'ckboxLinkId', attributeValue, modelElement );
				}
			}, { priority: 'low' } );
		} );

		// Convert `ckboxImageId` => `data-ckbox-resource-id`.
		editor.conversion.for( 'downcast' ).attributeToAttribute( {
			model: 'ckboxImageId',
			view: 'data-ckbox-resource-id'
		} );

		// Convert `data-ckbox-resource-id` => `ckboxImageId`.
		editor.conversion.for( 'upcast' ).elementToAttribute( {
			model: {
				key: 'ckboxImageId',
				value: viewElement => viewElement.getAttribute( 'data-ckbox-resource-id' )
			},
			view: {
				attributes: {
					'data-ckbox-resource-id': /[\s\S]+/
				}
			}
		} );
	}

	/**
	 * Registers post-fixers that add or remove the `ckboxLinkId` and `ckboxImageId` attributes.
	 *
	 * @private
	 */
	_initFixers() {
		const editor = this.editor;
		const model = editor.model;
		const selection = model.document.selection;

		// Registers the post-fixer to sync the asset ID with the model elements.
		model.document.registerPostFixer( syncDataIdPostFixer( editor ) );

		// Registers the post-fixer to remove the `ckboxLinkId` attribute from the model selection.
		model.document.registerPostFixer( injectSelectionPostFixer( selection ) );
	}
}

// A post-fixer that synchronizes the asset ID with the model element.
//
// @private
// @param {module:core/editor/editor~Editor} editor
// @returns {Function}
function syncDataIdPostFixer( editor ) {
	return writer => {
		let changed = false;

		const model = editor.model;
		const ckboxCommand = editor.commands.get( 'ckbox' );

		// The ID from chosen assets are stored in the `CKBoxCommand#_chosenAssets`. If there is no command, it makes no sense to check
		// for changes in the model.
		if ( !ckboxCommand ) {
			return changed;
		}

		for ( const entry of model.document.differ.getChanges() ) {
			if ( entry.type !== 'insert' && entry.type !== 'attribute' ) {
				continue;
			}

			const range = entry.type === 'insert' ?
				new Range( entry.position, entry.position.getShiftedBy( entry.length ) ) :
				entry.range;

			const isLinkHrefAttributeRemoval = entry.type === 'attribute' &&
				entry.attributeKey === 'linkHref' &&
				entry.attributeNewValue === null;

			for ( const item of range.getItems() ) {
				// If the `linkHref` attribute has been removed, sync the change with the `ckboxLinkId` attribute.
				if ( isLinkHrefAttributeRemoval && item.hasAttribute( 'ckboxLinkId' ) ) {
					writer.removeAttribute( 'ckboxLinkId', item );

					changed = true;

					continue;
				}

				// Otherwise, the change concerns either a new model element or an attribute change. Try to find the assets for the modified
				// model element.
				const assets = findAssetsForItem( item, ckboxCommand._chosenAssets );

				for ( const asset of assets ) {
					const attributeName = asset.type === 'image' ? 'ckboxImageId' : 'ckboxLinkId';

					if ( asset.id === item.getAttribute( attributeName ) ) {
						continue;
					}

					writer.setAttribute( attributeName, asset.id, item );

					changed = true;
				}
			}
		}

		return changed;
	};
}

// A post-fixer that removes the `ckboxLinkId` from the selection if it does not represent a link anymore.
//
// @private
// @param {module:engine/model/selection~Selection} selection
// @returns {Function}
function injectSelectionPostFixer( selection ) {
	return writer => {
		const shouldRemoveLinkIdAttribute = !selection.hasAttribute( 'linkHref' ) && selection.hasAttribute( 'ckboxLinkId' );

		if ( shouldRemoveLinkIdAttribute ) {
			writer.removeSelectionAttribute( 'ckboxLinkId' );
		}
	};
}

// Tries to find the asset that is associated with the model element by comparing the attributes:
// - the image fallback URL with the `src` attribute for images,
// - the link URL with the `href` attribute for links.
//
// For any model element, zero, one or more than one asset can be found (e.g. a linked image may be associated with the link asset and the
// image asset).
//
// @private
// @param {module:engine/model/item~Item} item
// @param {Set.<module:ckbox/ckbox~CKBoxAssetDefinition>} assets
// @returns {Array.<module:ckbox/ckbox~CKBoxAssetDefinition>}
function findAssetsForItem( item, assets ) {
	const isImageElement = item.is( 'element', 'imageInline' ) || item.is( 'element', 'imageBlock' );
	const isLinkElement = item.hasAttribute( 'linkHref' );

	return [ ...assets ].filter( asset => {
		if ( asset.type === 'image' && isImageElement ) {
			return asset.attributes.imageFallbackUrl === item.getAttribute( 'src' );
		}

		if ( asset.type === 'link' && isLinkElement ) {
			return asset.attributes.linkHref === item.getAttribute( 'linkHref' );
		}
	} );
}

// Creates view link element with the requested ID.
//
// @private
// @param {module:engine/view/downcastwriter~DowncastWriter} writer
// @param {String} id
// @returns {module:engine/view/attributeelement~AttributeElement}
function createLinkElement( writer, id ) {
	// Priority equal 5 is needed to merge adjacent `<a>` elements together.
	const viewElement = writer.createAttributeElement( 'a', { 'data-ckbox-resource-id': id }, { priority: 5 } );

	writer.setCustomProperty( 'link', true, viewElement );

	return viewElement;
}

// Checks if the model element may have the `ckboxLinkId` attribute.
//
// @private
// @param {module:engine/model/node~Node} node
// @returns {Boolean}
function shouldUpcastAttributeForNode( node ) {
	if ( node.is( '$text' ) ) {
		return true;
	}

	if ( node.is( 'element', 'imageInline' ) || node.is( 'element', 'imageBlock' ) ) {
		return true;
	}

	return false;
}
