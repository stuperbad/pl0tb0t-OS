(function($){
	// https://stackoverflow.com/questions/25514664/add-onclick-to-svg-path-by-id
    jQuery(document).ready(function() {
        /*
         * Replace all SVG images with inline SVG
         */
            jQuery('img.svg').each(function(){
                var $img = jQuery(this);
                var imgID = $img.attr('id');
                var imgClass = $img.attr('class');
                var imgURL = $img.attr('src');
        
                jQuery.get(imgURL, function(data) {
                    // Get the SVG tag, ignore the rest
                    var $svg = jQuery(data).find('svg');
        
                    // Add replaced image's ID to the new SVG
                    if(typeof imgID !== 'undefined') {
                        $svg = $svg.attr('id', imgID);
                    }
                    // Add replaced image's classes to the new SVG
                    if(typeof imgClass !== 'undefined') {
                        $svg = $svg.attr('class', imgClass+' replaced-svg');
                    }
                    
                    // Remove any invalid XML tags as per http://validator.w3.org
                    $svg = $svg.removeAttr('xmlns:a');
                    
                    // Replace image with new SVG
                    $img.replaceWith($svg);
                    
		            const allStates = $("path, polygon")

		            allStates.on("click", function() {

		                const colors = ['#8ad5e6', '#b0efd1', '#f0dec9', '#fab8ca', '#ff8ca4'];
		                let random_color = colors[Math.floor(Math.random() * colors.length)];

		                $(this)[0].style.fill = random_color

		            });
                });

            });
    });
})(jQuery);