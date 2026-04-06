import { APIProvider } from '@vis.gl/react-google-maps'
import AddPlaceView from './AddPlaceView'

export default function AddPlacePage() {
  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
      <AddPlaceView />
    </APIProvider>
  )
}
