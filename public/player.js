import api from './api.js'
import LLM from './llm.js'
import Kokoro from './speech.js'


// play first top track of an artist
export const play_artist = (artist, controller) => {
  api.call('GET', 'https://api.spotify.com/v1/search?q=' + artist + '&type=artist', null, function(data) {
    if (this.status == 200) {
      var data = JSON.parse(this.responseText);
      console.log(data);
      api.call('GET', 'https://api.spotify.com/v1/artists/' + data.artists.items[0].id + '/top-tracks', null, function(data) {
        if (this.status == 200) {
          var data = JSON.parse(this.responseText);
          console.log(data);
          console.log('playing', data.tracks[0])
          controller.loadUri(data.tracks[0].uri);
          controller.play();
        }
      });
    }
    else if (this.status == 401) {
      api.refreshAuth();
    }
    else {
      console.log(this.responseText);
    }
  })
}
